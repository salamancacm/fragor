/**
 * Source of truth for every type that crosses the engine boundary.
 * Everything here is plain JSON: no classes, Map, Set, functions, NaN or Infinity.
 */

/** Virtual time in milliseconds (float). */
export type Ms = number;

// ---------------------------------------------------------------------------
// Scenario (input)
// ---------------------------------------------------------------------------

export type Dist =
  | { type: "constant"; ms: Ms }
  | { type: "uniform"; minMs: Ms; maxMs: Ms }
  /** Normal truncated at 0 (rejection sampling). */
  | { type: "normal"; meanMs: Ms; stdMs: Ms }
  /** mu = ln(p50); sigma = (ln(p99) - ln(p50)) / 2.3263 */
  | { type: "lognormal"; p50Ms: Ms; p99Ms: Ms }
  | { type: "exponential"; meanMs: Ms }
  | { type: "mixture"; components: { weight: number; dist: Dist }[] };

export type FailureKind =
  | "http-5xx"
  | "timeout"
  | "connection-refused"
  | "circuit-open"
  | "bulkhead-full";

export const FAILURE_KINDS: readonly FailureKind[] = [
  "http-5xx",
  "timeout",
  "connection-refused",
  "circuit-open",
  "bulkhead-full",
];

export interface TimeoutPolicy {
  valueMs: Ms;
  /**
   * Who enforces the deadline (Fragor modeling extension). "timer" (default): it fires on time,
   * like the REST client read timeout enforced on the Vert.x event loop. "caller-pool": the
   * interruption is a task for the calling node's worker pool, like a synchronous SmallRye
   * @Timeout in Quarkus; it runs late when the pool is busy and is lost when its queue is full.
   * The scenario's defaultEdgeTimeoutMs (read timeout) still applies as an independent backstop.
   */
  enforcement?: "timer" | "caller-pool";
}

export interface RetryPolicy {
  maxRetries: number;
  delayMs: Ms;
  /** Delay = delay +/- jitter (uniform), never < 0. */
  jitterMs: Ms;
  maxDurationMs?: Ms;
  /** SmallRye extension (@ExponentialBackoff). */
  backoffFactor?: number;
  maxDelayMs?: Ms;
  /** Default: every FailureKind. */
  retryOn?: FailureKind[];
  /** Default: none. */
  abortOn?: FailureKind[];
}

export interface CircuitBreakerPolicy {
  /** Size of the sliding window of invocations. */
  requestVolumeThreshold: number;
  failureRatio: number;
  delayMs: Ms;
  successThreshold: number;
  /** Default: every FailureKind. */
  failOn?: FailureKind[];
}

export interface BulkheadPolicy {
  value: number;
  waitingTaskQueue?: number;
}

export interface FallbackPolicy {
  countsAs: "degraded" | "success";
  latency?: Dist;
}

/** Presence of a policy means it is enabled. */
export interface ClientPolicies {
  timeout?: TimeoutPolicy;
  retry?: RetryPolicy;
  circuitBreaker?: CircuitBreakerPolicy;
  bulkhead?: BulkheadPolicy;
  fallback?: FallbackPolicy;
}

export interface CallSpec {
  edgeId: string;
  /** Default 1. */
  probability?: number;
  /** If present, the call is made only when request.route is included. */
  routes?: string[];
  /** Default true; when false its failure does not fail the parent. */
  required?: boolean;
}

/** Extensible union: "database" | "kafka" | "cache" in the future. */
export type NodeKind = "service" | "external-api";

export interface NodeSpec {
  id: string;
  name: string;
  kind: NodeKind;
  /** Concurrency. */
  workers: number;
  /** Max waiting requests; null = unbounded. */
  queueLimit: number | null;
  /** blocking: the worker is held while waiting for dependencies. */
  workerModel: "blocking" | "async";
  /** Own processing time, excluding dependencies. */
  serviceTime: Dist;
  /** 0..1, probability of answering 500 after serviceTime. */
  errorRate: number;
  /** Dependencies, executed in sequence. */
  calls: CallSpec[];
}

export interface EdgeSpec {
  id: string;
  from: string;
  to: string;
  /** Network latency per leg (request and response are sampled separately). */
  latency: Dist;
  /** 0..1 per leg. */
  packetLoss: number;
  policies: ClientPolicies;
}

export type TrafficPattern =
  | { type: "constant"; rps: number }
  | { type: "poisson"; rps: number }
  | { type: "ramp"; fromRps: number; toRps: number; durationMs: Ms }
  | { type: "spike"; baseRps: number; peakRps: number; atMs: Ms; holdMs: Ms; rampMs?: Ms };

export interface TrafficSpec {
  id: string;
  /** Entry node id. */
  target: string;
  route?: string;
  pattern: TrafficPattern;
  startMs?: Ms;
  endMs?: Ms;
}

export type FaultTarget = { node: string } | { edge: string } | { traffic: string };

export type FaultEffect =
  | { type: "latency-add"; add: Dist }
  | { type: "latency-multiply"; factor: number }
  | { type: "error-rate"; rate: number }
  | { type: "outage"; mode: "refuse" | "blackhole" }
  | { type: "capacity"; workersFactor: number }
  | { type: "packet-loss"; rate: number }
  | { type: "traffic-multiply"; factor: number };

export interface FaultSpec {
  id: string;
  startMs: Ms;
  durationMs: Ms;
  target: FaultTarget;
  effect: FaultEffect;
}

/**
 * What a server does with the work of a caller that timed out (Fragor modeling extension).
 * "continue" (default): all of it runs to the end (orphaned work). "drop-queued": work still
 * waiting in the server's queue is discarded when a worker reaches it, work already running goes on
 * (observed in Quarkus when the client closes the connection). "cancel": both are cancelled.
 */
export type AbandonedWorkMode = "continue" | "drop-queued" | "cancel";

export interface ScenarioOptions {
  /** Same as abandonedWork "cancel" when true; kept for compatibility. Default false. */
  cancelOnTimeout?: boolean;
  /** Default "continue" ("cancel" when cancelOnTimeout is true). */
  abandonedWork?: AbandonedWorkMode;
  /** Default 30000. */
  defaultEdgeTimeoutMs?: Ms;
  /** Extra time after durationMs to finish in-flight work. Default 60000. */
  drainMs?: Ms;
}

export interface Scenario {
  schemaVersion: 1;
  name: string;
  description?: string;
  seed: number;
  /** Traffic generation horizon. */
  durationMs: Ms;
  options?: ScenarioOptions;
  /** Default bucketMs 1000. */
  metrics?: { bucketMs: Ms };
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  traffic: TrafficSpec[];
  faults: FaultSpec[];
}

// ---------------------------------------------------------------------------
// Simulation options (not part of the scenario)
// ---------------------------------------------------------------------------

export type EventKind =
  | "TRAFFIC_ARRIVAL"
  | "ARRIVE_AT_NODE"
  | "SERVICE_DONE"
  | "RESPONSE_AT_CALLER"
  | "TIMEOUT_FIRED"
  | "RETRY_DUE"
  | "FALLBACK_DONE"
  | "BREAKER_HALF_OPEN_DUE"
  | "FAULT_START"
  | "FAULT_END"
  | "METRICS_TICK";

export interface EventInfo {
  timeMs: Ms;
  seq: number;
  kind: EventKind;
}

export interface SimOptions {
  /** Max sampled traces. Default 200. */
  maxTraces?: number;
  /** Observer called after each processed event. Meant for tests and debugging. */
  onEvent?: (event: EventInfo) => void;
}

// ---------------------------------------------------------------------------
// Results (output)
// ---------------------------------------------------------------------------

export type RootOutcome = "success" | "degraded" | "failed" | "unfinished";
export type BreakerState = "closed" | "open" | "half-open";

/**
 * Per-bucket arrays, all with the same length. A field that does not apply to the
 * entity kind (e.g. utilization on an edge) is null as a whole.
 * Percentiles are null in buckets without samples.
 */
export interface Series {
  /** Requests that arrived (global: roots; node: requests reaching it; edge: invocations). */
  arrivals: number[];
  /** Arrivals per second. */
  rps: number[];
  success: number[];
  degraded: number[];
  failed: number[];
  p50Ms: (number | null)[];
  p95Ms: (number | null)[];
  p99Ms: (number | null)[];
  retries: number[];
  timeouts: number[];
  rejected503: number[];
  orphanedResponses: number[];
  orphanedWork: number[];
  /** Attempts made (edges: first attempts + retries, including circuit-open rejections). */
  attempts: number[];
  /** Attempts rejected by an open or saturated half-open circuit breaker. */
  circuitOpen: number[];
  /** Attempts rejected by a full bulkhead. */
  bulkheadFull: number[];
  /** Invocations answered by a fallback. */
  fallbacks: number[];
  /** "caller-pool" timeouts that ran late because the caller's workers were busy. */
  timeoutsDelayed: number[];
  /** "caller-pool" timeouts lost because the caller's queue was full. */
  timeoutsLost: number[];
  /** Queued requests discarded because their caller had left (abandonedWork "drop-queued"). */
  discardedWork: number[];
  queueDepthAvg: number[] | null;
  queueDepthMax: number[] | null;
  utilization: number[] | null;
  /** State at the end of each bucket (edges with a circuit breaker only). */
  breakerState: BreakerState[] | null;
}

export type TraceSpanKind = "root" | "job" | "invocation" | "attempt" | "retry-wait" | "fallback";

export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  kind: TraceSpanKind;
  nodeId: string | null;
  edgeId: string | null;
  startMs: Ms;
  endMs: Ms | null;
  outcome: RootOutcome;
  failure: FailureKind | null;
  /** 0-based attempt index for "attempt" spans, null otherwise. */
  attempt: number | null;
  /** Job spans: the caller timed out but the work went on. Attempt spans: response arrived late. */
  orphaned: boolean;
  /** Work or attempt cancelled (abandonedWork "cancel"), or queued work discarded ("drop-queued"). */
  cancelled: boolean;
}

export interface SampledTrace {
  traceId: string;
  rootId: string;
  trafficId: string;
  route: string | null;
  startMs: Ms;
  endMs: Ms | null;
  outcome: RootOutcome;
  failure: FailureKind | null;
  spans: TraceSpan[];
}

export interface SimulationSummary {
  roots: number;
  success: number;
  degraded: number;
  failed: number;
  unfinished: number;
  failureReasons: Record<FailureKind, number>;
  /** Over every completed root (success, degraded and failed); null when none completed. */
  avgLatencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  attempts: number;
  retries: number;
  timeouts: number;
  rejected503: number;
  orphanedWork: number;
  orphanedResponses: number;
  /** Successful roots per second of durationMs. */
  goodputRps: number;
  circuitOpen: number;
  bulkheadFull: number;
  fallbacks: number;
  timeoutsDelayed: number;
  timeoutsLost: number;
  discardedWork: number;
  /** Outcomes per traffic source id. */
  byTraffic: Record<string, TrafficSummary>;
}

export interface TrafficSummary {
  roots: number;
  success: number;
  degraded: number;
  failed: number;
  unfinished: number;
  p50Ms: number | null;
  p99Ms: number | null;
}

export interface SimulationResult {
  resultSchemaVersion: 1;
  scenarioName: string;
  seed: number;
  summary: SimulationSummary;
  series: {
    bucketMs: Ms;
    /** Number of buckets; every series array has this length. */
    buckets: number;
    global: Series;
    nodes: Record<string, Series>;
    edges: Record<string, Series>;
  };
  events: {
    breakerTransitions: { tMs: Ms; edgeId: string; from: BreakerState; to: BreakerState }[];
    faults: { tMs: Ms; id: string; phase: "start" | "end" }[];
  };
  traces: SampledTrace[];
  stats: { eventsProcessed: number; wallClockMs: number };
  /** Hash of everything above except stats.wallClockMs: proof of determinism. */
  fingerprint: string;
}

export interface NodeSnapshot {
  arrivals: number;
  completed: number;
  inService: number;
  queueDepth: number;
  /** Requests whose worker was released but are still waiting for dependencies (async). */
  waitingOnDependencies: number;
  /** "caller-pool" timeout tasks waiting in this node's queue (not counted in queueDepth). */
  queuedTimerTasks: number;
  effectiveWorkers: number;
  busyWorkers: number;
}

export interface EdgeSnapshot {
  /** Attempts sent and not yet resolved (response or timeout) from the caller's view. */
  inFlight: number;
  breakerState: BreakerState | null;
  bulkheadRunning: number | null;
  bulkheadQueued: number | null;
}

export interface LiveSnapshot {
  nowMs: Ms;
  roots: { arrived: number; completed: number; inFlight: number };
  nodes: Record<string, NodeSnapshot>;
  edges: Record<string, EdgeSnapshot>;
}

export interface Simulation {
  readonly nowMs: Ms;
  /** Advances virtual time up to tMs (clamped to the horizon). */
  runUntil(tMs: Ms): void;
  snapshot(): LiveSnapshot;
  /** Runs to the end (traffic horizon + drain) and builds the result. */
  finish(): SimulationResult;
}
