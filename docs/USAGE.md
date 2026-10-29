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

On the first visit a welcome screen explains Fragor in three steps and offers a **guided tour**
(eight steps over example 01: each region is outlined and explained, and the replay moves to the
moment that matters) or to **model your own service**. *How it works* in the top bar opens it again;
every section and number has a **?** with a plain-language explanation.

1. **Pick a scenario** in the top bar; it runs at once (the first one runs when the page opens).
2. **Read the headline**: one paragraph built from the run (what set things off, how far the
   saturation spread, how many requests failed or got a fallback), then five numbers: success,
   served by fallback, failed, p99 latency and load amplification (attempts per call), each with
   its shape over time and its change against the previous run.
3. **Watch the replay**. *Request flow* replays the run: dots are requests (top lane) and responses
   (bottom lane: cyan success, violet fallback, red failed); rejected requests (503, circuit open,
   bulkhead full) fall out of the flow. Cards fill their worker and queue gauges and turn BUSY,
   SATURATED or OVERLOADED; a fault shows an amber badge while it lasts; a circuit breaker is a gate
   that turns as it opens. Play, pause, change the speed (1×, 4×, 10×) or drag the timeline (arrow
   keys move one second, Shift+arrow ten). One dot stands for several requests on busy links; the
   numbers on the cards and links are exact.
4. **What's happening** narrates the run as it plays (fault starts, a service saturates, sheds load,
   a retry storm, the breaker opens, users see errors, recovery). Click an event to jump there.
5. **Findings** are rule-based (no AI). Open one to see the numbers behind it; *at 11 s ▸* replays
   from that moment and outlines the node or edge.
6. **What if…**: change the traffic multiplier or, per edge, timeout, retries, where the timeout
   runs and the circuit breaker, then press **Run with N changes**. The numbers, the charts (dashed:
   previous run) and the *Before / after* table compare the new run with the previous one.

### Your own system

Fragor does not connect to your running services yet: you describe them with numbers from your
configuration and metrics, or import the OpenTelemetry traces they already produce (see
[Importing traces](#importing-traces)), and it simulates what happens when something fails. Press
**Your scenario** in the top bar:

- **Quick form** (one service of yours and one dependency it calls): requests per second, worker
  threads (`quarkus.thread-pool.max-threads`), queue limit, the service's own time (p50/p99,
  without the call), the dependency's response time and error rate, your timeout, retries, circuit
  breaker and fallback, and what to try (the dependency gets slower, returns errors or goes down).
  **Run my scenario** validates and replays it; it then appears in the picker as *Yours · …* and
  the *What if…* panel works on it. **Continue in JSON** opens it as JSON to add more services.
- **JSON** (any architecture): paste a scenario or open a `.json` file (same format as the CLI and
  `packages/scenarios/examples`), then **Validate and run**. Errors name the field, e.g.
  `nodes[api].workers: Too small` or `traffic[web].target: unknown node "ghost"`, and JSON syntax
  errors give the line and column. **Load the scenario on screen** starts from the current one.

**Download this scenario (JSON)** in *What if…* saves the scenario on screen, with your changes,
to run it with the CLI or share it. The form and the JSON are remembered in this browser only
(local storage); nothing is sent anywhere.

### Importing traces

If your services already send OpenTelemetry traces, Fragor can build a draft of your system from
them: which services call which, how often, how long each takes, retries and timeouts. It reads the
file in your browser (or with the CLI); nothing is sent anywhere. It is an *import*: Fragor never
connects to your services.

**1. Get a traces file.** Send the traces of your services to an OpenTelemetry Collector with the
[file exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/fileexporter/README.md),
which writes one OTLP JSON document per line (the `json` format is its default):

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
exporters:
  file:
    path: /out/traces.jsonl
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [file]
```

In Quarkus, add the `quarkus-opentelemetry` extension (it instruments REST servers and REST
clients) and point it at the Collector with `quarkus.otel.exporter.otlp.endpoint` (default
`http://localhost:4317`, gRPC). Then use the system as usual, or run a load test, for a few minutes.
The Quarkus demo has a ready recipe: [examples/quarkus-demo](../examples/quarkus-demo/README.md),
"Capturing traces".

**2. Import it.** In the web app: *Your scenario → Import traces from your services*, drop the
file. Or from the command line:

```bash
fragor import traces traces.jsonl --from 2026-10-29T19:08:38Z --to 2026-10-29T19:08:41Z \
  --out draft.json --report report.md
fragor run draft.json
```

**3. Use a calm period** (`--from` / `--to`, or the range fields in the web app). A server span
includes the time a request waited for a worker, so response times measured while a service was
saturated are inflated. Requests refused with 503 (a full queue) are counted and left out.

**4. Answer what the traces cannot tell.** Fragor lists *open questions*: threads and queue sizes
(`quarkus.thread-pool.max-threads` and `quarkus.thread-pool.queue-size` in Quarkus), whether a
thread waits for its dependencies, circuit breakers and fallbacks. In the web app each has a small
form; with the CLI use `--set nodes.order.workers=100` (the same patches as `fragor run`). Until
answered, a placeholder is used and marked *assumed*; the report says which numbers are measured,
inferred (and by which rule), from configuration, given by you or assumed.

What is read from the traces:

| Parameter | How |
| --- | --- |
| Services and calls | a client span and the server span below it; a call without server spans is an external API |
| Traffic | requests that start a trace, per second |
| How often a call is made | requests of the caller that made it, over all requests of the caller |
| Own time (p50 / p99) | the server span minus the time spent in its calls |
| Network | half the difference between a call's duration and its server span |
| Retries | the most attempts seen for one request, minus one: **at least** (the cap may never have been reached) |
| Timeout | when callers stopped waiting: gaps between an attempt left running and its retry, or a call outliving its caller. A timeout that fires late (a saturated caller) looks longer than configured |
| Own error rate | errors that none of the request's calls caused; 503 rejections and timeouts are not the service's own |

Inferred timeouts and retries are asked to be confirmed. The draft is a starting point: run it, then
compare it with what you observed.

To publish the app, serve `apps/web/out` with any static file server. To serve it from a
sub-path, build with `FRAGOR_BASE_PATH=/name pnpm web:build` (in Git Bash on Windows, prefix
`MSYS_NO_PATHCONV=1` so the path is not rewritten).

**GitHub Pages:** `.github/workflows/pages.yml` runs lint, typecheck and tests, builds the app with
the Pages path (`/<repo>` for a project site) and deploys it on every push to `main`. In the
repository settings choose *Pages > Source: GitHub Actions*. On the free plan Pages needs a public
repository.

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
