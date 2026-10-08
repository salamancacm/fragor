# Using Fragor

Fragor simulates a microservice architecture under load and faults, so you can see how timeouts,
retries, circuit breakers, bulkheads and fallbacks change the outcome before production does.

> **A simulation is not a prediction.** Every number depends on the parameters you assume
> (workers, queues, service times, traffic). Use Fragor to understand *mechanisms*: how a failure
> propagates and which policy contains it. To check a model against real services, see
> [Comparing with real services](#7-comparing-with-real-services).

## 1. Install

Requirements: [pnpm](https://pnpm.io) 10. Node 24 is pinned per project: pnpm downloads it on
install, your global Node is not touched.

```bash
pnpm install
pnpm build
```

`pnpm build` produces the CLI (`packages/cli/dist/fragor.mjs`) and the static web app
(`apps/web/out`).

## 2. The web app

```bash
pnpm web:dev
```

Open http://localhost:3000. The simulation runs in a Web Worker in your browser; nothing is sent
anywhere.

1. **Pick a scenario** in *Example* and press **Run**. The first one runs automatically.
2. **Read the summary cards**: success, degraded (answered by a fallback), failed, latency
   (avg, p95, p99, end to end, retries included), retries and timeouts.
3. **Move the time slider** under the architecture graph. Nodes and edges are colored by health in
   that second: utilization (⚙), failed responses (✗), queue (≡), breaker state on edges.
4. **Charts**: throughput, p95, error rate, queue depth, utilization and breaker state. Red bands
   are the injected faults; the dashed line is the previous run.
5. **Insights** are rule-based findings computed from the run (no AI). Click a piece of evidence
   to jump the slider to that moment and highlight the node or edge.
6. **Change parameters** (traffic multiplier; per edge: timeout, retries, circuit breaker) and
   press **Run** again. Every change is listed under *What-if changes*; the cards, charts and the
   *Before / after* table compare the new run with the previous one.

To publish the app, serve `apps/web/out` with any static file server.

## 3. The command line

```bash
node packages/cli/dist/fragor.mjs run packages/scenarios/examples/01-payment-slow-baseline.json
```

| Command | What it does |
| --- | --- |
| `fragor run <file>` | Runs a scenario and prints the summary, per-traffic outcomes and findings. |
| `fragor run <file> --json` | Prints the full result (JSON) for scripts and notebooks. |
| `fragor run <file> --digest` | Prints the compact analysis digest (summary, timeline, per-node/edge stats, findings). |
| `fragor run <file> --set path=value` | What-if: edits the scenario before running (repeatable). |
| `fragor run <file> --unset path` | Removes an optional field, e.g. a policy. |
| `fragor run <file> --seed N` | Overrides the random seed. |
| `fragor compare a.json b.json` | Runs both and prints a before/after table (`--json` for machines). |
| `fragor schema [--out file]` | Prints the JSON Schema of a scenario. |

Paths in `--set` and `--unset` address nodes, edges, traffic sources and faults by id:

```bash
# shorter timeout on order -> payment
fragor run s.json --set edges.order-payment.policies.timeout.valueMs=1500
# turn retries off
fragor run s.json --unset edges.order-payment.policies.retry
# add a circuit breaker (the value is JSON)
fragor run s.json --set 'edges.order-payment.policies.circuitBreaker={"requestVolumeThreshold":20,"failureRatio":0.5,"delayMs":5000,"successThreshold":1}'
# double the traffic
fragor run s.json --set traffic.web.pattern.rps=200
```

Exit codes: `0` ok, `1` unexpected error, `2` invalid input (usage, JSON or scenario errors, with
readable messages such as `edges[order-payment].packetLoss: Too big: expected number to be <=1`).

The same scenario and seed always give the same result, with the same `fingerprint`, in the CLI
and in any browser.

## 4. Writing a scenario

A scenario is a JSON file. Start from one in `packages/scenarios/examples/` and read
[SCENARIOS.md](SCENARIOS.md). The JSON Schema in `packages/scenarios/schema/scenario.schema.json`
documents every field with its meaning and unit. Map your scenario files to it in your editor for
completion and inline docs (in VS Code, the `json.schemas` setting with `fileMatch` for your scenario
folder). Scenario files must not contain extra keys (such as `$schema`): unknown keys are errors, so
typos never pass silently.

The building blocks:

- **nodes**: services with `workers` (concurrency), `queueLimit` (503 when full; `null` =
  unbounded), `workerModel` (`blocking` holds the worker while waiting for dependencies, `async`
  does not), `serviceTime` (a distribution, e.g. lognormal by p50/p99), `errorRate` and `calls`.
- **edges**: the link from a caller to a dependency: network `latency`, `packetLoss` and the
  caller's **policies** (`timeout`, `retry`, `circuitBreaker`, `bulkhead`, `fallback`), composed as
  `Fallback(Retry(CircuitBreaker(Timeout(Bulkhead(call)))))` like MicroProfile Fault Tolerance.
- **traffic**: `constant`, `poisson`, `ramp` or `spike` sources hitting an entry node; `route`
  lets calls apply only to some endpoints.
- **faults**: time-boxed latency, error rate, outage, capacity loss, packet loss or traffic surges.

**Quarkus users:** a synchronous `@Timeout` is enforced on the caller's worker pool, so it runs
late or is lost when that pool is saturated. Model it with
`"timeout": { "valueMs": 2000, "enforcement": "caller-pool" }` (in the web app: *Timeout runs on
caller's pool*). The REST client `read-timeout` fires on time: keep the default `"timer"`. The
finding `timeout-starvation` tells you when this matters.

**What happens to the work of a caller that gave up** is set by `options.abandonedWork`:
`"continue"` (default: everything runs, counted as orphaned work), `"drop-queued"` (work still
queued at the server is discarded, running work goes on: what Quarkus does when the client closes
the connection; discarded requests are counted as `discardedWork`) or `"cancel"` (both stop).

How each rule works, and which framework documentation it follows, is in
[SEMANTICS.md](SEMANTICS.md).

## 5. Reading the results

- **Success / degraded / failed** are per root request (one request from a traffic source).
  *Degraded* means a fallback answered: the user got something, but not the real thing.
- **Failure reasons** count the root cause: e.g. a timeout deep in the call chain, even if the
  user saw a 500 from the gateway.
- **Orphaned work**: work a service finished after its caller had given up (timed out). It used
  workers for nothing; it is how slowness turns into saturation.
- **Retries / attempts**: how much extra load retries created. Attempts rejected by an open
  breaker do not reach the dependency, but still add retry delays.
- **Findings** (`worker-saturation`, `cascade-propagation`, `retry-amplification`,
  `orphaned-work`, `missing-timeout`, `single-point-of-failure`) point to concrete evidence: node or
  edge, time window and metric.

## 6. A guided first session

1. Run **01 · Slow payment API**: an external provider gets 5 s slower for 30 s. Watch payment
   saturate, then order, then the gateway (finding *cascade-propagation*).
2. Turn the **circuit breaker** on for `order -> payment` and run again. The breaker opens: p95
   drops, failures turn into fast failures. Without a fallback, more requests fail.
3. Pick **02**, which also has a degraded **fallback**: failures become degraded answers.
4. Run **03** and **04**: the same slowness takes down an unrelated endpoint (/users) until a
   **bulkhead** isolates it.
5. Run **06**, then raise *jitter* with the CLI
   (`--set edges.clients-api.policies.retry.jitterMs=500`): synchronized retries stop hammering
   the API in waves.

## 7. Comparing with real services

`examples/quarkus-demo` contains real Quarkus services built like scenario 01/02 (same workers,
queues, service times, policies and fault), a k6 load test and the mirror Fragor scenarios. Its
[README](../examples/quarkus-demo/README.md) explains how to run it and what the comparison
showed so far, including where reality and the model disagree.

## 8. Development

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm bench        # performance budget of the engine
```

See [ARCHITECTURE.md](ARCHITECTURE.md) and [DECISIONS.md](DECISIONS.md).
