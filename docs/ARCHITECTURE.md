# Architecture

Fragor is a monorepo. The engine is the product; every other package is a consumer of it.

```
packages/engine     @fragor/engine     pure TS, zero runtime deps, no DOM, no Node APIs
packages/scenarios  @fragor/scenarios  (M3) Zod schemas, examples, patches, findings, digest
packages/cli        @fragor/cli        (M3) `fragor run|compare`
apps/web            Next.js UI         (M4) runs the engine in a Web Worker
```

Dependency direction: `web`, `cli`, `scenarios` -> `engine`. Never the reverse.
`packages/scenarios` validates untrusted input with Zod and hands the engine already-typed values.
The types in `packages/engine/src/model/types.ts` are the source of truth; Zod schemas are
declared `satisfies z.ZodType<Scenario>` so the compiler detects divergence.

## Engine modules

```
engine/src
├─ core/        pure building blocks, no simulation knowledge
│  ├─ event-queue.ts    binary min-heap ordered by (timeMs, seq)
│  ├─ rng.ts            sfc32 PRNG; createStream(seed, ...path) derives independent sub-streams
│  ├─ hash.ts           cyrb128 string hash (stream seeds, trace sampling, fingerprint)
│  ├─ distributions.ts  compileDist(): validates a Dist and returns a sampler
│  ├─ histogram.ts      log-linear histogram (integer ns, 128 sub-buckets per octave)
│  ├─ fifo.ts           O(1) FIFO queue
│  └─ clock.ts          the only wall-clock access (stats.wallClockMs)
├─ model/types.ts       source of truth for every input/output type
├─ runtime/
│  ├─ scheduler.ts      the event kernel: virtual clock, schedule/cancel, runUntil
│  ├─ node-behavior.ts  Job, NodeContext, NodeBehavior: the node extension point
│  ├─ service-node.ts   workers + FIFO queue + 503 + serviceTime + errorRate
│  ├─ traffic.ts        constant / poisson / ramp / spike arrival generators
│  ├─ roots.ts          root requests: creation, final outcome, end-to-end latency
│  ├─ validate.ts       engine-level structural checks
│  └─ simulation.ts     wires everything; createSimulation() / simulate()
├─ policies/            (M2) timeout, retry, circuit-breaker, bulkhead, fallback
├─ metrics/
│  ├─ series-builder.ts per-entity bucket series (counters, percentiles, time-weighted gauges)
│  ├─ collector.ts      bucket clock shared by every series
│  ├─ traces.ts         deterministic bottom-k trace sampling and span trees
│  └─ summary.ts        summary and fingerprint
└─ index.ts             public API
```

## Event flow

Virtual time only; the engine never reads the wall clock inside simulation logic (a test
scans `src/` for `Math.random`, `Date.now` and `performance.now`).

The kernel (`Scheduler`) holds a binary heap ordered by `(timeMs, seq)`; `seq` is a monotonic
counter, so simultaneous events run in the order they were scheduled. Each event carries its
`kind` (for observability) and a `fire` closure owned by whoever scheduled it, so the kernel
knows nothing about nodes, policies or metrics. Cancellation is lazy: a cancelled event stays in
the heap and is skipped when popped. Before firing an event the kernel calls
`metrics.advanceTo(t)`, which closes every bucket that ended at or before `t`.

```
TRAFFIC_ARRIVAL   source fires -> RootTracker.create -> Job at the entry node -> node.arrive(job)
                  -> source schedules its next arrival (one pending arrival per source)
node.arrive       free worker? start : queue has room? enqueue : reply 503 (http-5xx)
start             busy++, sample serviceTime -> schedule SERVICE_DONE
SERVICE_DONE      draw error (always) -> release worker -> reply 200/500 -> start next queued job
job.reply         roots: RootTracker.complete (success | failed + reason)
                  M2: attempts schedule RESPONSE_AT_CALLER after the return network leg
METRICS_TICK      every bucketMs while traffic is scheduled or work is pending
(M2) ARRIVE_AT_NODE, RESPONSE_AT_CALLER, TIMEOUT_FIRED, RETRY_DUE, BREAKER_HALF_OPEN_DUE,
     FAULT_START, FAULT_END
```

The run ends at `durationMs + drainMs` (the horizon) or earlier when no work is pending.
Roots still in flight at the horizon are `unfinished`.

Randomness: every entity owns independent sub-streams per purpose, derived from
`hash(seed, kind, entityId, purpose)` (e.g. `node/order/service`, `node/order/error`,
`traffic/web/arrivals`). Adding an entity never shifts another entity's random sequence, and
a node always draws its error decision even when `errorRate` is 0, so changing `errorRate`
does not shift its service times.

## Metrics

Series are bucketed by `floor(t / bucketMs)`. Counters are incremented in the current bucket;
latencies go to a per-bucket histogram whose p50/p95/p99 are taken when the bucket closes;
queue depth, busy workers and effective workers are time-weighted (integral of level x time),
giving average queue depth and utilization = integral(busy) / integral(effective workers).
Every bucket spans a full `bucketMs`; after the run ends the state is frozen.

## Public API

```ts
simulate(scenario, opts?): SimulationResult      // pure w.r.t. the scenario
createSimulation(scenario, opts?): Simulation    // runUntil / snapshot / finish, for streaming
```

`SimOptions`: `maxTraces` (default 200) and `onEvent` (observer used by tests).
There is no global mutable state: several simulations can run in parallel or interleaved.

## Extensibility: new node types

A node kind is a `NodeBehavior` registered in `NODE_FACTORIES` (`runtime/simulation.ts`).
Adding one (database with a connection pool, kafka with partitions, cache) means writing a
factory and registering it; the kernel, traffic, metrics and client policies are untouched.

```ts
interface Job {                       // one request that reached a node
  readonly id: number;
  readonly root: RootRequest;         // inherited rootId and route
  readonly arrivedAtMs: Ms;
  readonly reply: (r: JobResult) => void;  // call exactly once, when the response leaves
  span: SpanRef | null;               // trace span (null when not sampled)
}
type JobResult = { ok: true } | { ok: false; failure: FailureKind };

interface NodeContext {               // services available to a behavior
  readonly scheduler: Scheduler;      // nowMs, schedule(at, kind, fire), cancel(event)
  readonly series: SeriesBuilder;     // this node's metrics
  stream(purpose: string): Rng;       // independent RNG sub-stream of this node
  // M2: invoke(edgeId, parentJob, done) to call a dependency through the client policies
}

interface NodeBehavior {
  readonly spec: NodeSpec;
  arrive(job: Job): void;             // admission, processing and reply are up to the node
  snapshot(): NodeSnapshot;
}
type NodeFactory = (spec: NodeSpec, ctx: NodeContext) => NodeBehavior;
```

The caller side never looks inside a node: it only creates a `Job` with a `reply` callback.
That is what lets the M2 call pipeline (network, timeout, retry, breaker, bulkhead, fallback)
wrap any node kind.

## Serialization

`Scenario` and `SimulationResult` are plain JSON: no classes, `Map`, `Set`, functions, `NaN` or
`Infinity` (use `null`). Both carry a version (`schemaVersion`, `resultSchemaVersion`).
`JSON.parse(JSON.stringify(result))` must preserve the fingerprint and structure.

## Future: AI layer

Nothing in this repository calls a model, and nothing will until the author asks.
The design rules that keep it easy and safe to add later:

- AI never computes results or modifies the engine. It may only (a) propose scenarios or typed
  patches that go through validation, and (b) explain results the engine already computed.
- Package boundary: `packages/ai` (future) depends on `engine`, never the reverse. `engine`
  imports nothing AI-related and makes no network calls. The package is not created until needed.
- Stable IDs for nodes, edges, faults and traces; every finding references evidence as
  `{ nodeId | edgeId | traceId, fromMs, toMs, metric }`.
- Deterministic findings (rules, no AI): retry-amplification, worker-saturation, orphaned-work,
  cascade-propagation, missing-timeout, single-point-of-failure (M3), plus a stable
  `buildAnalysisDigest(result, findings)` that fits in a few thousand tokens.
- Edits go through pure `applyPatch(scenario, ops)` (set, add-node, remove-node, add-edge,
  remove-edge); it returns a new scenario and never mutates.
- Privacy by default: no network or telemetry in engine, CLI or web unless the user opts in.
  A future provider interface will be provider-agnostic (local model or the user's own key),
  with no keys or vendors hard-coded.
- Any AI-generated text shown in the UI must be labeled as such and display the evidence
  (findings and metrics) it relies on.
