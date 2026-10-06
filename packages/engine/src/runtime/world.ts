import { createStream } from "../core/rng";
import type { MetricsCollector } from "../metrics/collector";
import { openChildSpan, type SpanRef } from "../metrics/traces";
import type { BreakerState, EdgeSpec, Ms, NodeKind, Scenario, TrafficSpec } from "../model/types";
import { Bulkhead } from "../policies/bulkhead";
import { CircuitBreaker } from "../policies/circuit-breaker";
import { compileFallback } from "../policies/fallback";
import { attemptTimeoutMs } from "../policies/timeout";
import { type CallWorld, Invocation } from "./call-pipeline";
import { FaultRegistry } from "./faults";
import { type EdgeRuntime, NetworkLink } from "./network";
import type { Job, JobResult, NodeBehavior, NodeContext, NodeFactory } from "./node-behavior";
import type { RootRequest, RootTracker } from "./roots";
import type { Scheduler } from "./scheduler";
import { createServiceNode } from "./service-node";
import { TrafficSource } from "./traffic";

/** Registry of node behaviors. A new node kind is added here, nowhere else. */
const NODE_FACTORIES: Record<NodeKind, NodeFactory> = {
  service: createServiceNode,
  "external-api": createServiceNode,
};

export interface WorldEvents {
  breakerTransitions: { tMs: Ms; edgeId: string; from: BreakerState; to: BreakerState }[];
  faults: { tMs: Ms; id: string; phase: "start" | "end" }[];
}

/** Every runtime entity of one simulation, wired together. No global state. */
export class World implements CallWorld {
  readonly nodes = new Map<string, NodeBehavior>();
  readonly edges = new Map<string, EdgeRuntime>();
  readonly faults: FaultRegistry;
  readonly cancelOnTimeout: boolean;
  readonly global;
  private jobSeq = 0;

  constructor(
    private readonly scenario: Scenario,
    readonly scheduler: Scheduler,
    private readonly metrics: MetricsCollector,
    private readonly roots: RootTracker,
    readonly events: WorldEvents,
  ) {
    this.global = metrics.global;
    this.cancelOnTimeout = scenario.options?.cancelOnTimeout ?? false;
    this.faults = new FaultRegistry(scenario.faults, scheduler, (id, phase, tMs) =>
      events.faults.push({ tMs, id, phase }),
    );
    for (const spec of scenario.edges) this.edges.set(spec.id, this.buildEdge(spec));
    for (const spec of scenario.nodes) {
      const node = NODE_FACTORIES[spec.kind](spec, this.nodeContext(spec.id));
      this.nodes.set(spec.id, node);
      this.faults.subscribe({ node: spec.id }, () => node.onFaultsChanged());
    }
  }

  /** Starts the traffic sources. Call after construction, once metrics ticks are scheduled. */
  startTraffic(): void {
    for (const spec of this.scenario.traffic) {
      const rng = createStream(this.scenario.seed, "traffic", spec.id, "arrivals");
      const source = new TrafficSource(
        spec,
        this.scenario.durationMs,
        this.scheduler,
        rng,
        () => this.faults.trafficFactor(spec.id),
        (t) => this.onTrafficArrival(t),
      );
      this.faults.subscribe({ traffic: spec.id }, () => source.onRateChanged());
      source.start();
    }
  }

  deliver(
    nodeId: string,
    parent: Job | RootRequest,
    parentSpan: SpanRef | null,
    reply: (r: JobResult) => void,
    orphaned: boolean,
  ): Job | null {
    const outage = this.faults.node(nodeId).outage;
    if (outage === "refuse") {
      reply({ ok: false, failure: "connection-refused", cause: "connection-refused" });
      return null;
    }
    if (outage === "blackhole") return null;
    const now = this.scheduler.nowMs;
    const job: Job = {
      id: this.jobSeq++,
      nodeId,
      root: "root" in parent ? parent.root : parent,
      arrivedAtMs: now,
      reply,
      span: openChildSpan(parentSpan, "job", now, { nodeId }),
      orphaned,
      cancelled: false,
    };
    this.node(nodeId).arrive(job);
    return job;
  }

  cancelJob(job: Job): void {
    this.node(job.nodeId).cancel(job);
  }

  private node(id: string): NodeBehavior {
    const node = this.nodes.get(id);
    if (node === undefined) throw new Error(`unknown node "${id}"`);
    return node;
  }

  private onTrafficArrival(spec: TrafficSpec): void {
    const now = this.scheduler.nowMs;
    const root = this.roots.create(spec.id, spec.route ?? null, now);
    this.deliver(
      spec.target,
      root,
      root.span,
      (r) => {
        const at = this.scheduler.nowMs;
        if (r.ok) this.roots.complete(root, at, r.degraded ? "degraded" : "success", null);
        else this.roots.complete(root, at, "failed", r.cause);
      },
      false,
    );
  }

  private nodeContext(nodeId: string): NodeContext {
    const seed = this.scenario.seed;
    return {
      scheduler: this.scheduler,
      series: this.metrics.addNode(nodeId),
      global: this.metrics.global,
      stream: (purpose) => createStream(seed, "node", nodeId, purpose),
      faults: () => this.faults.node(nodeId),
      invoke: (edgeId, parent, done) => {
        const edge = this.edges.get(edgeId);
        if (edge === undefined) throw new Error(`unknown edge "${edgeId}"`);
        return new Invocation(this, edge, parent, done);
      },
    };
  }

  private buildEdge(spec: EdgeSpec): EdgeRuntime {
    const seed = this.scenario.seed;
    const stream = (purpose: string) => createStream(seed, "edge", spec.id, purpose);
    const { circuitBreaker, bulkhead, fallback } = spec.policies;
    const series = this.metrics.addEdge(spec.id, { breaker: circuitBreaker !== undefined });
    const breaker =
      circuitBreaker === undefined
        ? null
        : new CircuitBreaker(circuitBreaker, this.scheduler, (from, to, tMs) => {
            this.events.breakerTransitions.push({ tMs, edgeId: spec.id, from, to });
            series.setBreakerState(to);
          });
    return {
      spec,
      series,
      timeoutMs: attemptTimeoutMs(spec, this.scenario.options?.defaultEdgeTimeoutMs),
      breaker,
      bulkhead: bulkhead === undefined ? null : new Bulkhead(bulkhead),
      fallback:
        fallback === undefined
          ? null
          : compileFallback(fallback, `edges[${spec.id}].policies.fallback`),
      network: new NetworkLink(
        spec,
        this.faults,
        stream("latency"),
        stream("loss"),
        stream("fault-latency"),
      ),
      policyRng: stream("policy"),
      inFlight: 0,
    };
  }
}
