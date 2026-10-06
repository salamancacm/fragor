# Writing a scenario

A scenario is a plain JSON document describing an architecture, its load and its faults.
The TypeScript source of truth is `packages/engine/src/model/types.ts` (`Scenario`).
Zod schemas with per-field descriptions and a generated JSON Schema arrive in M3
(`packages/scenarios`); until then this page is the guide.

## Skeleton

```json
{
  "schemaVersion": 1,
  "name": "my-scenario",
  "seed": 42,
  "durationMs": 60000,
  "metrics": { "bucketMs": 1000 },
  "nodes": [],
  "edges": [],
  "traffic": [],
  "faults": []
}
```

## Parts

- **nodes**: services or external APIs with `workers`, `queueLimit` (`null` = unbounded),
  `workerModel` (`blocking` | `async`), `serviceTime` (a distribution), `errorRate` (0..1) and
  `calls` (dependencies, run in sequence, each pointing at an edge).
- **edges**: `from` -> `to`, with `latency`, `packetLoss` (0..1) and client `policies`
  (`timeout`, `retry`, `circuitBreaker`, `bulkhead`, `fallback`; presence enables it).
- **traffic**: sources targeting an entry node: `constant`, `poisson`, `ramp` or `spike`.
- **faults**: time-boxed effects on a node, edge or traffic source (latency, errors, outage,
  capacity, packet loss, traffic multiplier).

All times are virtual milliseconds (`...Ms`). Rates are requests per second (`rps`) or fractions
in 0..1. The same scenario and seed always produce the same result.

## Conventions

- IDs are stable strings; edges reference nodes by id and calls reference edges by id.
- The call graph must not contain cycles.
- Policy names mirror MicroProfile Fault Tolerance / SmallRye (see SEMANTICS.md).

Canonical examples will live in `packages/scenarios/examples/` (M2).
