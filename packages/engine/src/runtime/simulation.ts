import { wallClockNow } from "../core/clock";
import { MetricsCollector } from "../metrics/collector";
import { buildSummary, computeFingerprint } from "../metrics/summary";
import { TraceSampler } from "../metrics/traces";
import type {
  EdgeSnapshot,
  LiveSnapshot,
  Ms,
  NodeSnapshot,
  Scenario,
  SimOptions,
  Simulation,
  SimulationResult,
} from "../model/types";
import { RootTracker } from "./roots";
import { Scheduler } from "./scheduler";
import { validateScenario } from "./validate";
import { World, type WorldEvents } from "./world";

export const DEFAULT_BUCKET_MS = 1000;
export const DEFAULT_DRAIN_MS = 60_000;
export const DEFAULT_MAX_TRACES = 200;

class SimulationRun implements Simulation {
  private readonly scheduler: Scheduler;
  private readonly metrics: MetricsCollector;
  private readonly roots: RootTracker;
  private readonly world: World;
  private readonly events: WorldEvents = { breakerTransitions: [], faults: [] };
  private readonly horizonMs: Ms;
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
    this.roots = new RootTracker(
      this.metrics.global,
      sampler,
      scenario.traffic.map((t) => t.id),
    );
    this.scheduleTick(this.metrics.bucketMs);
    this.world = new World(scenario, this.scheduler, this.metrics, this.roots, this.events);
    this.world.startTraffic();
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
    for (const [id, node] of this.world.nodes) nodes[id] = node.snapshot();
    const edges: Record<string, EdgeSnapshot> = {};
    for (const [id, e] of this.world.edges) {
      edges[id] = {
        inFlight: e.inFlight,
        breakerState: e.breaker?.state ?? null,
        bulkheadRunning: e.bulkhead?.running ?? null,
        bulkheadQueued: e.bulkhead?.queued ?? null,
      };
    }
    return {
      nowMs: this.scheduler.nowMs,
      roots: {
        arrived: this.roots.created,
        completed: this.roots.completed,
        inFlight: this.roots.created - this.roots.completed,
      },
      nodes,
      edges,
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
          byTraffic: this.roots.byTraffic(),
        },
        this.metrics,
        this.scenario.durationMs,
      ),
      series: { bucketMs: this.metrics.bucketMs, buckets, ...this.metrics.build(buckets) },
      events: {
        breakerTransitions: this.events.breakerTransitions.map((e) => ({ ...e })),
        faults: this.events.faults.map((e) => ({ ...e })),
      },
      traces: this.roots.traces(),
      stats: { eventsProcessed: this.scheduler.eventsProcessed, wallClockMs: 0 },
    };
    const fingerprint = computeFingerprint(partial);
    this.wallMs += wallClockNow() - t0;
    partial.stats.wallClockMs = this.wallMs;
    this.result = { ...partial, fingerprint };
    return this.result;
  }

  /** Bucket boundaries are closed lazily by the kernel; ticks keep series current while streaming. */
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
