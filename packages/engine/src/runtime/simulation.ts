import { wallClockNow } from "../core/clock";
import { createStream } from "../core/rng";
import { MetricsCollector } from "../metrics/collector";
import { buildSummary, computeFingerprint } from "../metrics/summary";
import { openChildSpan, TraceSampler } from "../metrics/traces";
import type {
  LiveSnapshot,
  Ms,
  NodeKind,
  NodeSnapshot,
  Scenario,
  SimOptions,
  Simulation,
  SimulationResult,
  TrafficSpec,
} from "../model/types";
import type { Job, NodeBehavior, NodeFactory } from "./node-behavior";
import { RootTracker } from "./roots";
import { Scheduler } from "./scheduler";
import { createServiceNode } from "./service-node";
import { TrafficSource } from "./traffic";
import { validateScenario } from "./validate";

export const DEFAULT_BUCKET_MS = 1000;
export const DEFAULT_DRAIN_MS = 60_000;
export const DEFAULT_MAX_TRACES = 200;

/** Registry of node behaviors. A new node kind is added here, nowhere else. */
const NODE_FACTORIES: Record<NodeKind, NodeFactory> = {
  service: createServiceNode,
  "external-api": createServiceNode,
};

class SimulationRun implements Simulation {
  private readonly scheduler: Scheduler;
  private readonly metrics: MetricsCollector;
  private readonly roots: RootTracker;
  private readonly nodes = new Map<string, NodeBehavior>();
  private readonly horizonMs: Ms;
  private jobSeq = 0;
  private wallMs = 0;
  private result: SimulationResult | null = null;

  constructor(
    private readonly scenario: Scenario,
    opts: SimOptions,
  ) {
    validateScenario(scenario);
    this.horizonMs = scenario.durationMs + (scenario.options?.drainMs ?? DEFAULT_DRAIN_MS);
    this.metrics = new MetricsCollector(scenario.metrics?.bucketMs ?? DEFAULT_BUCKET_MS);
    this.scheduler = new Scheduler((t) => this.metrics.advanceTo(t), opts.onEvent);
    const sampler = new TraceSampler(scenario.seed, opts.maxTraces ?? DEFAULT_MAX_TRACES);
    this.roots = new RootTracker(this.metrics.global, sampler);
    this.scheduleTick(this.metrics.bucketMs);
    for (const spec of scenario.nodes) {
      const ctx = {
        scheduler: this.scheduler,
        series: this.metrics.addNode(spec.id),
        stream: (purpose: string) => createStream(scenario.seed, "node", spec.id, purpose),
      };
      this.nodes.set(spec.id, NODE_FACTORIES[spec.kind](spec, ctx));
    }
    for (const spec of scenario.traffic) {
      const rng = createStream(scenario.seed, "traffic", spec.id, "arrivals");
      const source = new TrafficSource(spec, scenario.durationMs, this.scheduler, rng, (t) =>
        this.onTrafficArrival(t),
      );
      source.start();
    }
  }

  get nowMs(): Ms {
    return this.scheduler.nowMs;
  }

  runUntil(tMs: Ms): void {
    if (this.result !== null) throw new Error("simulation already finished");
    const t0 = wallClockNow();
    this.scheduler.runUntil(Math.min(tMs, this.horizonMs));
    this.wallMs += wallClockNow() - t0;
  }

  snapshot(): LiveSnapshot {
    const nodes: Record<string, NodeSnapshot> = {};
    for (const [id, node] of this.nodes) nodes[id] = node.snapshot();
    return {
      nowMs: this.scheduler.nowMs,
      roots: {
        arrived: this.roots.created,
        completed: this.roots.completed,
        inFlight: this.roots.created - this.roots.completed,
      },
      nodes,
      edges: {},
    };
  }

  finish(): SimulationResult {
    if (this.result !== null) return this.result;
    const t0 = wallClockNow();
    this.scheduler.runUntil(this.horizonMs);
    const endMs = this.scheduler.hasPendingWork()
      ? this.horizonMs
      : Math.max(this.scenario.durationMs, this.scheduler.lastWorkMs);
    const buckets = this.metrics.finalize(endMs);
    const partial: Omit<SimulationResult, "fingerprint"> = {
      resultSchemaVersion: 1,
      scenarioName: this.scenario.name,
      seed: this.scenario.seed,
      summary: buildSummary(
        {
          created: this.roots.created,
          completed: this.roots.completed,
          outcomes: this.roots.outcomeCounts(),
          reasons: this.roots.failureReasons(),
          latency: this.roots.latencyStats(),
        },
        this.metrics,
        this.scenario.durationMs,
      ),
      series: { bucketMs: this.metrics.bucketMs, buckets, ...this.metrics.build(buckets) },
      events: { breakerTransitions: [], faults: [] },
      traces: this.roots.traces(),
      stats: { eventsProcessed: this.scheduler.eventsProcessed, wallClockMs: 0 },
    };
    const fingerprint = computeFingerprint(partial);
    this.wallMs += wallClockNow() - t0;
    partial.stats.wallClockMs = this.wallMs;
    this.result = { ...partial, fingerprint };
    return this.result;
  }

  private onTrafficArrival(spec: TrafficSpec): void {
    const now = this.scheduler.nowMs;
    const root = this.roots.create(spec.id, spec.route ?? null, now);
    const node = this.nodes.get(spec.target) as NodeBehavior;
    const job: Job = {
      id: this.jobSeq++,
      root,
      arrivedAtMs: now,
      span: openChildSpan(root.span, "job", now, { nodeId: spec.target }),
      reply: (result) => {
        const at = this.scheduler.nowMs;
        if (result.ok) this.roots.complete(root, at, "success", null);
        else this.roots.complete(root, at, "failed", result.failure);
      },
    };
    node.arrive(job);
  }

  /** Bucket boundaries are closed lazily by the kernel; ticks only keep series current while streaming. */
  private scheduleTick(atMs: Ms): void {
    if (atMs > this.horizonMs) return;
    this.scheduler.schedule(atMs, "METRICS_TICK", () => {
      const next = atMs + this.metrics.bucketMs;
      if (next <= this.scenario.durationMs || this.scheduler.hasPendingWork()) {
        this.scheduleTick(next);
      }
    });
  }
}

export function createSimulation(scenario: Scenario, opts: SimOptions = {}): Simulation {
  return new SimulationRun(scenario, opts);
}

export function simulate(scenario: Scenario, opts: SimOptions = {}): SimulationResult {
  return createSimulation(scenario, opts).finish();
}
