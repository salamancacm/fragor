# Architecture

Fragor is a monorepo. The engine is the product; every other package is a consumer of it.

```
packages/engine     @fragor/engine     pure TS, zero runtime deps, no DOM, no Node APIs
packages/scenarios  @fragor/scenarios  Zod schemas, JSON Schema, patches, findings, digest, examples
packages/cli        @fragor/cli        `fragor run|compare|schema` (bundled with esbuild)
apps/web            @fragor/web        Next.js static UI; runs the engine in a Web Worker
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
│  ├─ math.ts           detLog / detExp: identical bits in every JS engine
│  └─ clock.ts          the only wall-clock access (stats.wallClockMs)
├─ model/types.ts       source of truth for every input/output type
├─ runtime/
│  ├─ scheduler.ts      the event kernel: virtual clock, schedule/cancel, runUntil
│  ├─ node-behavior.ts  Job, JobResult, NodeContext, NodeBehavior: the node extension point
│  ├─ service-node.ts   workers, FIFO queue, 503, serviceTime, errorRate, calls, blocking/async
│  ├─ call-pipeline.ts  Invocation: Fallback(Retry(CircuitBreaker(Timeout(Bulkhead(attempt)))))
│  ├─ network.ts        per-edge links: leg latency and packet loss; EdgeRuntime
│  ├─ faults.ts         FaultRegistry: FAULT_START/END and combined effects per target
│  ├─ traffic.ts        constant / poisson / ramp / spike arrival generators
│  ├─ roots.ts          root requests: creation, final outcome, latency, per-traffic totals
│  ├─ world.ts          builds and wires nodes, edges, faults and traffic for one run
│  ├─ validate*.ts      engine-level structural checks (references, cycles, parameters)
│  └─ simulation.ts     createSimulation() / simulate(): run loop, snapshot, result
├─ policies/            client policies, independent of nodes and of the kernel
│  ├─ timeout.ts        attempt deadline (default 30 000 ms)
│  ├─ retry.ts          retryOn/abortOn, maxRetries, maxDuration, delay/backoff/jitter
│  ├─ circuit-breaker.ts CLOSED/OPEN/HALF_OPEN with generations
│  ├─ bulkhead.ts       semaphore + optional FIFO waiting queue
│  └─ fallback.ts       degraded/success answer with optional latency
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
TRAFFIC_ARRIVAL       source fires -> RootTracker.create -> world.deliver(entry node)
                      (node outage: refuse -> connection-refused; blackhole -> no answer)
node.arrive           free worker? start : queue has room? enqueue : reply 503 (http-5xx)
SERVICE_DONE          error draw -> 500, or run calls in sequence (async: release worker first)
  call                ctx.invoke(edge) -> Invocation:
                        breaker.tryAcquire()      rejected -> circuit-open (no network)
                        schedule TIMEOUT_FIRED    (before the bulkhead)
                        bulkhead.enter()          rejected -> bulkhead-full / queued
                        request leg               lost -> only the timeout resolves it
ARRIVE_AT_NODE        world.deliver(target) -> node.arrive(job)
job.reply             response leg (may be lost) -> RESPONSE_AT_CALLER
RESPONSE_AT_CALLER    attempt already timed out? orphanedResponses : resolve attempt
TIMEOUT_FIRED         attempt fails with timeout; server job marked orphaned (or cancelled)
resolve attempt       breaker.record -> retry? RETRY_DUE : fallback? FALLBACK_DONE : done
BREAKER_HALF_OPEN_DUE OPEN -> HALF_OPEN after delayMs
FAULT_START/END       FaultRegistry updates combined effects and notifies subscribers
                      (nodes: capacity; traffic sources: rate)
METRICS_TICK          every bucketMs while traffic is scheduled or work is pending
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
  readonly nodeId: string;
  readonly root: RootRequest;         // inherited rootId and route
  readonly arrivedAtMs: Ms;
  readonly reply: (r: JobResult) => void;  // call exactly once, when the response leaves
  readonly span: SpanRef | null;      // trace span (null when not sampled)
  orphaned: boolean;                  // the caller timed out; work goes on
  cancelled: boolean;                 // the caller cancelled it
}
type JobResult =
  | { ok: true; degraded: boolean }
  | { ok: false; failure: FailureKind; cause: FailureKind };  // cause = root cause

interface NodeContext {               // services available to a behavior
  readonly scheduler: Scheduler;      // nowMs, schedule(at, kind, fire), cancel(event)
  readonly series: SeriesBuilder;     // this node's metrics
  readonly global: SeriesBuilder;     // global series (shared counters)
  stream(purpose: string): Rng;       // independent RNG sub-stream of this node
  faults(): NodeEffects;              // combined effect of active faults on this node
  invoke(edgeId, parent, done): InvocationHandle;  // call a dependency through the client policies
}

interface NodeBehavior {
  readonly spec: NodeSpec;
  arrive(job: Job): void;             // admission, processing and reply are up to the node
  cancel(job: Job): void;             // caller cancelled (cancelOnTimeout); must not reply
  onFaultsChanged(): void;            // capacity / latency / error faults changed
  snapshot(): NodeSnapshot;
}
type NodeFactory = (spec: NodeSpec, ctx: NodeContext) => NodeBehavior;
```

The caller side never looks inside a node: it only creates a `Job` with a `reply` callback.
That is what lets the call pipeline (network, timeout, retry, breaker, bulkhead, fallback) wrap
any node kind. Outages are applied by `World.deliver` before the node sees the request, so new
node kinds get them for free; latency, error-rate and capacity faults are read by the behavior
through `ctx.faults()`.

## Scenarios package (`@fragor/scenarios`)

```
scenarios/src
├─ schema.ts          Zod schemas, `satisfies z.ZodType<EngineType>`, `.describe()` on every field
├─ references.ts      cross references, relations between numbers, call cycles
├─ validate.ts        parseScenario / safeParseScenario with id-based error paths
├─ json-schema.ts     scenarioJsonSchema() (draft 2020-12) -> schema/scenario.schema.json
├─ patch.ts           applyPatch / parsePatch: typed, validated, non-mutating edits
└─ analysis/
   ├─ findings.ts     deriveFindings(scenario, result): rule-based, deterministic
   ├─ rules-*.ts      one file per family of rules
   └─ digest.ts       buildAnalysisDigest(scenario, result, findings)
```

## Analysis: findings and digest

Findings are derived by rules from a scenario and the result the engine computed for it. They
never compute new simulation data. Each has a stable id (`rule:target`), a severity, a summary
built from computed numbers and evidence `{ nodeId | edgeId | traceId, fromMs, toMs, metric,
value }` where `metric` names a field of the result.

| Rule | Fires when | Severity |
| --- | --- | --- |
| worker-saturation | node utilization >= 0.95 for >= 2 s | critical if it also shed 503s or filled its queue |
| cascade-propagation | a caller saturates at or after the dependency it calls (chain from an origin) | critical if the chain reaches an entry node |
| retry-amplification | attempts / calls >= 1.5 on an edge with retry | by attempts that reached the dependency: >= 2.5 critical, >= 1.5 warning; info if most were rejected by breaker or bulkhead |
| orphaned-work | a node finished work after its caller timed out | critical if >= 10% of its completed work |
| timeout-starvation | "caller-pool" timeouts ran late or were lost because the caller had no free worker | critical if any was lost |
| missing-timeout | an edge has no timeout policy | warning if its p99 reached half the default timeout or it hit it |
| single-point-of-failure | every traffic source needs the node through required calls with no fallback | warning if it failed or saturated in the run, else info |

Thresholds are in `DEFAULT_THRESHOLDS` and can be overridden per call.

The digest is a stable, compact JSON (about 2-7 kB for the canonical scenarios): disclaimer,
summary, per-traffic outcomes, a timeline of fault and breaker events (capped), one line per
node and edge, and the findings. It is what a report, the UI "Insights" panel or a future AI
explainer consumes; the explainer cites its evidence instead of inventing numbers.

## CLI (`@fragor/cli`)

`main(argv, io)` parses arguments with `node:util` `parseArgs`, loads a scenario
(`parseScenario`), applies `--set` / `--unset` / `--seed` as typed patches (`applyPatch`), runs
`simulate`, and prints a summary with findings, the JSON result, the digest, or a before/after
comparison (`compareResults`). `build.mjs` bundles it into `dist/fragor.mjs`.

## Web app (`apps/web`)

```
apps/web/src
├─ app/                 layout (system fonts, TooltipProvider) and the single Runner page
├─ worker/
│  ├─ sim.worker.ts     the Web Worker: receives `run` / `cancel`, posts progress and results
│  └─ run-loop.ts       runInChunks(): runUntil in chunks + snapshot(), then finish + findings
├─ lib/
│  ├─ protocol.ts       typed messages: ToWorker (run, cancel) / FromWorker (progress, done, cancelled, error)
│  ├─ use-simulation.ts React hook owning the worker; reducer keeps `current` and `previous` runs
│  ├─ params.ts         parameters panel state -> PatchOp[] (validated by applyPatch)
│  ├─ graph-layout.ts   layered DAG layout (callers left of dependencies)
│  ├─ health.ts         node/edge health per time bucket (display thresholds)
│  ├─ chart-data.ts     chart rows (current run + previous run overlay, fault windows)
│  └─ examples.ts       the canonical scenarios, validated with parseScenario
└─ components/          Runner, ArchitectureGraph (@xyflow/react), Charts (Recharts), SummaryCards,
                        ParamsPanel, Insights (findings), ComparisonTable, HonestyBanner, ui/ (shadcn)
```

Flow: the user picks a scenario and adjusts parameters -> `patchFor` + `applyPatch` produce a
validated scenario -> `run` posts it to the worker -> the worker posts `progress` (with a live
snapshot) about 60 times and then `done` with the result and its findings -> the reducer moves the
old `current` to `previous` -> cards, graph, charts, insights and the before/after table render
from plain JSON. The time slider selects a bucket; the graph colors nodes and edges by their health
in that bucket; clicking a finding's evidence moves the slider and highlights the target.

The web app is a static export: no server, no network calls, no telemetry.

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
  `{ nodeId | edgeId | traceId, fromMs, toMs, metric }`. The M2 result already carries what
  such evidence needs: per-node utilization and queue depth per bucket, per-edge attempts,
  retries, timeouts and breaker state, fault and breaker events with times, root causes, and
  traces whose spans link each attempt, retry wait and fallback to its parent.
- Deterministic findings (rules, no AI) are implemented: `deriveFindings` and a stable
  `buildAnalysisDigest(scenario, result, findings)` that fits in a few thousand tokens. A future
  explainer receives the digest, never control over the engine.
- Edits go through pure `applyPatch(scenario, ops)` (set, unset, add-node, remove-node, add-edge,
  remove-edge); it returns a new, validated scenario and never mutates. Patches proposed from
  outside are checked with `parsePatch` first.
- The scenario JSON Schema (`schema/scenario.schema.json`) documents every field with meaning
  and unit, so a model or a person can generate a valid scenario from it alone; the result is
  still validated by `parseScenario`.
- Privacy by default: no network or telemetry in engine, CLI or web unless the user opts in.
  A future provider interface will be provider-agnostic (local model or the user's own key),
  with no keys or vendors hard-coded.
- Any AI-generated text shown in the UI must be labeled as such and display the evidence
  (findings and metrics) it relies on.
