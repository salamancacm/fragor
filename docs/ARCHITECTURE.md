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

## Engine modules (planned layout)

```
engine/src
├─ core/      event-queue (binary heap), rng (seeded sub-streams), distributions, histogram, ids
├─ model/     types.ts — Scenario, NodeSpec, EdgeSpec, policies, results
├─ runtime/   simulation, service-node, call-pipeline, network, traffic, faults
├─ policies/  timeout, retry, circuit-breaker, bulkhead, fallback
├─ metrics/   collector, summary, comparison
└─ index.ts   public API: simulate(), createSimulation()
```

## Event flow

Virtual time only; the engine never reads the wall clock inside simulation logic.
The queue is a binary heap ordered by `(timeMs, seq)`; `seq` is a monotonic counter that breaks
ties deterministically.

```
TRAFFIC_ARRIVAL -> creates root request -> starts an attempt on the entry node's call pipeline
call pipeline:  Fallback( Retry( CircuitBreaker( Timeout( Bulkhead( attempt ) ) ) ) )
attempt:        ARRIVE_AT_NODE -> admission (worker / queue / 503) -> SERVICE_DONE
                -> downstream calls in sequence -> RESPONSE_AT_CALLER
timers:         TIMEOUT_FIRED, RETRY_DUE, BREAKER_HALF_OPEN_DUE
faults:         FAULT_START / FAULT_END toggle effects on nodes, edges, traffic sources
metrics:        METRICS_TICK closes a bucket
```

Randomness: each node, edge and traffic source owns an independent sub-stream derived from
`hash(seed, entityId)`, so adding an entity does not perturb the others.

## Public API

```ts
simulate(scenario, opts?): SimulationResult      // pure w.r.t. the scenario
createSimulation(scenario, opts?): Simulation    // runUntil / snapshot / finish, for streaming
```

There is no global mutable state: several simulations can run in parallel or interleaved.

## Extensibility: new node types (design contract)

A node type is a behavior that decides how a request is admitted, processed and answered.
Adding one (database, kafka, cache) must not touch the event core or the client policies:

```ts
interface NodeBehavior {
  admit(req: Incoming, ctx: NodeContext): "start" | "queue" | "reject";
  process(req: Incoming, ctx: NodeContext): ProcessPlan; // own time, error decision, downstream calls
  onComplete(req: Incoming, ctx: NodeContext): void;     // release resources
}
```

This is the intended shape. It is finalized in M1/M2 together with the `service` and
`external-api` kinds, and the final signatures will be recorded here when implemented.

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
