# Writing a scenario

A scenario is a plain JSON document describing an architecture, its load and its faults.
The TypeScript source of truth is `packages/engine/src/model/types.ts` (`Scenario`).
The JSON Schema `packages/scenarios/schema/scenario.schema.json` documents every field (meaning
and unit). Point your editor at it, or print it with `fragor schema`.

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

## Canonical examples

`packages/scenarios/examples/` contains the scenarios used by the tests. Each one isolates a
mechanism; run them and compare (the engine computes every number, none are written by hand).

| File | Mechanism |
| --- | --- |
| `01-payment-slow-baseline.json` | An external API becomes 5 s slower for 30 s. Timeout 2 s + 3 retries, no breaker: retries amplify load, workers saturate, the slowness cascades up to the gateway. |
| `02-payment-slow-with-breaker.json` | Same fault with a circuit breaker and a degraded fallback: the breaker opens, fails fast and the gateway is protected; results become degraded instead of failed. |
| `03-cascade-blast-radius.json` | A blocking gateway serves /users and /orders; /orders depends on a slow payment service. Gateway workers pile up and /users fails too. |
| `04-cascade-with-bulkhead.json` | Scenario 03 with a bulkhead on gateway -> order-service: /orders fails fast, /users stays healthy. |
| `05-traffic-spike-10x.json` | A 10x traffic spike against a finite queue: load shedding with 503 and degraded latency. |
| `06-retry-storm-jitter.json` | A synchronized burst retried with `jitterMs: 0`: retries arrive in waves every second. Set `jitterMs` to 500 to spread them. |

## Validating and editing

```ts
import { applyPatch, parseScenario } from "@fragor/scenarios";

const scenario = parseScenario(JSON.parse(text)); // throws with readable issues
const faster = applyPatch(scenario, [
  { op: "set", path: "edges.order-payment.policies.timeout.valueMs", value: 1500 },
  { op: "unset", path: "edges.order-payment.policies.retry" },
]);
```

Errors name items by id, e.g. `edges[order-payment].packetLoss: Too big: expected number to be <=1`.
Unknown keys are errors, so typos do not pass silently.

## From the command line

```bash
pnpm build
node packages/cli/dist/fragor.mjs run packages/scenarios/examples/01-payment-slow-baseline.json
node packages/cli/dist/fragor.mjs run packages/scenarios/examples/01-payment-slow-baseline.json --set edges.order-payment.policies.timeout.valueMs=1500
node packages/cli/dist/fragor.mjs compare packages/scenarios/examples/01-payment-slow-baseline.json packages/scenarios/examples/02-payment-slow-with-breaker.json
```

`run` prints a summary and the findings; `--json` prints the full result and `--digest` the
analysis digest. `compare` prints a before/after table.

## Writing your own

1. Start from the skeleton and add nodes; keep `workers`, `queueLimit` and `serviceTime`
   realistic for what you want to learn, not exact.
2. Add edges for each dependency and reference them from the caller's `calls`, in the order the
   calls happen. Use `routes` on a call and `route` on a traffic source to model endpoints.
3. Add policies one at a time and compare runs: the difference is the lesson.
4. Add faults with a start and a duration so you see before, during and after.
5. Use a smaller `metrics.bucketMs` (e.g. 100) to see bursts, a larger one for long runs.

Remember: a simulation is not a prediction. It shows how a mechanism behaves under the
parameters you assumed.
