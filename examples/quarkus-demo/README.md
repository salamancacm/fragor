# Quarkus demo: real services vs the Fragor model

Four real Quarkus services built to mirror Fragor scenarios 01 and 02, a k6 load test that injects
the same fault, and the mirror Fragor scenarios in `fragor/`. Use it to compare what the model says
with what real services do, and to find the assumptions that matter.

```
k6 ──100 rps──▶ gateway ──▶ order ──▶ payment ──▶ external-payment
                (200 thr)   (100 thr)  (50 thr)    (1000 thr, +5 s from t=10 s to t=40 s)
                timeout 10s timeout 2s  read timeout 30 s
                            retry 3 (delay 100, jitter 50)
                            [breaker + fallback with ORDER_PROFILE=breaker]
```

| Fragor element | Real counterpart |
| --- | --- |
| `workers` | `quarkus.thread-pool.max-threads` |
| `queueLimit` | `quarkus.thread-pool.queue-size` (requests beyond it get 503) |
| `serviceTime` | `SimulatedWork.sleep(...)` with the same distribution |
| edge `timeout`, `retry`, `circuitBreaker`, `fallback` | `@Timeout`, `@Retry`, `@CircuitBreaker`, `@Fallback` on `PaymentGateway` / `OrderGateway` |
| edge without timeout policy | REST client `read-timeout` (30 s) |
| fault `latency-add` | `POST /admin/latency?extraMs=5000` on external-payment |
| traffic `constant` 100 rps | k6 `constant-arrival-rate` 100/s |

## Requirements

Java 21, Maven 3.9 and Docker (Compose v2).

## Run

```bash
cd examples/quarkus-demo
mvn -B package -DskipTests              # builds the four services
docker compose up -d --build            # starts them (gateway on :8080)
docker compose run --rm k6              # 60 s load test with the fault; summary in results/
```

With the circuit breaker and the fallback (scenario 02):

```bash
ORDER_PROFILE=breaker docker compose up -d order
ORDER_PROFILE=breaker docker compose run --rm k6
```

The same model in Fragor (from the repository root, after `pnpm build`):

```bash
node packages/cli/dist/fragor.mjs run examples/quarkus-demo/fragor/baseline.json
node packages/cli/dist/fragor.mjs run examples/quarkus-demo/fragor/breaker.json
```

Stop everything with `docker compose down`.

Behind a TLS-intercepting proxy (for example Cloudflare WARP) Maven may fail with
`PKIX path building failed`. On Windows, make Java use the system certificate store for that run:
`MAVEN_OPTS="-Djavax.net.ssl.trustStoreType=Windows-ROOT" mvn -B package -DskipTests`.

Manual fault injection: `curl -X POST "localhost:8083/admin/latency?extraMs=5000"`, restore with
`curl -X DELETE localhost:8083/admin/latency`.

## Capturing traces (for `fragor import traces`)

The demo can also be traced with OpenTelemetry, to try Fragor's import on real telemetry. It is
optional and off by default: the validated runs above measure the services without tracing.

```bash
export MAVEN_OPTS="-Djavax.net.ssl.trustStoreType=Windows-ROOT"   # only behind a TLS-inspecting proxy
mvn -Ptelemetry package -DskipTests     # adds quarkus-opentelemetry to every service
docker compose -f docker-compose.yml -f docker-compose.telemetry.yml up -d --build
# warm up (curl -X POST localhost:8080/checkout a few hundred times), then restart the collector
# for a clean file, then run the load:
RATE=30 docker compose -f docker-compose.yml -f docker-compose.telemetry.yml run --rm k6
```

The OpenTelemetry Collector in `telemetry/otel-collector.yaml` receives the traces over OTLP/gRPC
(the Quarkus default) and its file exporter writes `results/telemetry/traces.jsonl`. Rebuild
without the profile (`mvn package -DskipTests`) before the validation runs.

```bash
fragor import traces results/telemetry/traces.jsonl --from <start of a calm period> --to <3 s later> \
  --out draft.json --report report.md
```

What importing the traces of this demo (30 req/s, the fault from 10 s to 40 s) gives, against the
configuration the services really have (2026-10-29):

| | Imported | Configured |
| --- | --- | --- |
| Traffic, calm window | 30.01 req/s | 30 |
| Calls made per request | 1.00 on each of the three | 1 |
| Own time of `order` p50 / p99 | 12 / 47 ms | lognormal 10 / 40 ms (+ framework time) |
| Network between services | 0.3 to 0.4 ms | not set |
| `order → payment` retries | at least 2 | 3 (no request reached the fourth attempt) |
| `order → payment` timeout | 2,053 ms (76 observations) | 2,000 ms (the gap adds the retry delay, 50 to 150 ms) |
| `gateway → order` timeout | 9,999 ms (186 observations, whole run) | 10,000 ms |
| Own error rate of every service | 0 | 0 (503 rejections and timeouts are not own errors) |

Three things the traces showed, which changed how the importer reads them:

- Retries are separate client spans under one server span, with the gaps between them showing the
  timeout. With `@Timeout` the client span is **not** cut at the timeout: it ends when the response
  finally arrives (5 to 10 s later under saturation), with a normal status. A timeout therefore
  shows in the gap before the retry, never as an error on the call.
- A queue that is full answers with a server span of about 1 ms, status error, HTTP 503: load
  shedding, not a failure of the service.
- 186 of the gateway's 500 errors had no failing call below them: they were its 10 s timeouts. Reading
  them as the gateway's own errors would have been wrong.

The draft built from a calm window reproduces the end-to-end latency that was observed: simulated
p50 / p95 / p99 of 150.5 / 261.6 / 324.0 ms against 150.7 / 257.1 / 319.1 ms measured, before
answering any question (at this load the placeholders for threads and queues do not matter).

## Measure and compare

Every service exposes `GET /probe` (served on the Vert.x event loop, so it answers even when all
worker threads are busy) with the quantities the Fragor model uses: requests waiting for a thread
(`waiting`, Fragor queue depth), running (`inService`, busy workers), still running after the caller
closed the connection (`orphanedNow`; `orphanedWork` counts the finished ones), responses by status
and outbound calls per target with a duration histogram. Order and gateway record each outbound call
twice: per attempt (inside `@Timeout`) and per invocation (outside, retries included).

One command runs an experiment: it polls the probes every 500 ms, runs k6, runs the mirror scenario
in Fragor and prints both side by side every 2 s, plus totals.

```bash
(cd ../.. && pnpm build)                     # once: builds the Fragor CLI
docker compose up -d --build
load/experiment.sh my-run                    # results/compare-my-run.txt
ORDER_PROFILE=breaker docker compose up -d order && ORDER_PROFILE=breaker load/experiment.sh my-breaker-run
```

## What we found (2026-10-07, 24-CPU machine, Docker Desktop)

### Root cause of the discrepancy: `@Timeout` depends on the saturated worker pool

With the default setup the model and reality disagreed (success 49% vs 72%, p95 2.3 s vs 26 s). The
probes showed why: under saturation, order's attempts to payment lasted **5 to 20 s** although they
are annotated `@Timeout(2000)`, and only 23 of 4260 attempts timed out. Payment never accumulated
orphaned work, never rejected anything, and the congestion moved up to the gateway queue instead.

The mechanism, verified in the source code:

1. SmallRye's `Timeout` schedules the interruption on a timer:
   `timer.schedule(timeoutInMillis, execution::timeoutAndInterrupt, ...)`
   ([Timeout.java](https://github.com/smallrye/smallrye-fault-tolerance/blob/6.11.4/implementation/core/src/main/java/io/smallrye/faulttolerance/core/timeout/Timeout.java)).
2. The timer is one thread that, when a task is due, **submits it to an executor**
   ([ThreadTimer.java](https://github.com/smallrye/smallrye-fault-tolerance/blob/6.11.4/implementation/core/src/main/java/io/smallrye/faulttolerance/core/timer/ThreadTimer.java));
   that executor is the async executor
   ([ExecutorHolder.java](https://github.com/smallrye/smallrye-fault-tolerance/blob/6.11.4/implementation/fault-tolerance/src/main/java/io/smallrye/faulttolerance/ExecutorHolder.java): `new ThreadTimer(asyncExecutor)`).
3. In Quarkus the async executor is the `ManagedExecutor`, i.e. the same worker pool that runs the
   blocking REST endpoints
   ([QuarkusAsyncExecutorProvider.java](https://github.com/quarkusio/quarkus/blob/3.40.1/extensions/smallrye-fault-tolerance/runtime/src/main/java/io/quarkus/smallrye/faulttolerance/runtime/QuarkusAsyncExecutorProvider.java)).

So when the pool is saturated the timeout task waits in the queue behind requests (late timeout), and
when the queue is full it is rejected and **the timeout is silently lost**. The order logs show it:
`SRFTL11000: Unexpected exception in timer loop, ignoring: java.util.concurrent.RejectedExecutionException`
from thread `SmallRye Fault Tolerance Timer 1`, raised by `EnhancedQueueExecutor.rejectQueueFull`.
A single request on an idle system times out correctly (8.36 s = 4 attempts of 2 s + delays), which is
why this only appears under load: exactly when the timeout is needed.

### When the model's assumption holds, model and reality agree

Fragor assumes a timeout fires on time. The Quarkus REST client `read-timeout` is enforced by Vert.x
on the event loop, outside the worker pool, so setting it to the same values makes that assumption
true (`ORDER_PAYMENT_READ_TIMEOUT=2000 GATEWAY_ORDER_READ_TIMEOUT=10000`):

| | Fragor model | Real, `@Timeout` only | Real, `read-timeout` |
| --- | --- | --- | --- |
| Baseline: success / failed | 48.9% / 51.1% | 71.8% / 28.2% | 49.5% / 50.5% |
| Baseline: p50 / p95 / p99 | 274 ms / 2.3 s / 2.4 s | 149 ms / 26.6 s / 28.0 s | 370 ms / 2.7 s / 4.3 s |
| Baseline: requests reaching payment | 15,271 | 4,266 | 15,172 |
| Baseline: 503 rejections at payment | 11,939 | 0 | 11,304 |
| Baseline: orphaned work at payment | 400 | 0 | 300 |
| Breaker: success / degraded / failed | 39.3% / 60.8% / 0% | 38.3% / 33.4% / 28.3% | 40.2% / 59.8% / 0% |
| Breaker: p50 / p95 / p99 | 280 ms / 656 ms / 2.3 s | 177 ms / 26.4 s / 27.9 s | 277 ms / 612 ms / 2.3 s |
| Breaker: requests reaching payment | 2,459 | not measured | 2,516 |

(The `@Timeout`-only breaker run predates the probes; its row comes from the k6 summary.)

Remaining differences with `read-timeout`, all small: payment's waiting queue stays around 50
instead of the model's 100, the real system oscillates in waves of a few seconds where the model is
smoother, and the real tail (p99 4.3 s vs 2.4 s) is longer.

### Lessons

- In Quarkus, a synchronous `@Timeout` **does not protect a saturated service**: its interruption
  runs on the very pool that is saturated. Set the REST client `read-timeout` (event loop) as well,
  and keep the worker queue bounded so overload fails fast.
- The Quarkus REST client has a **hidden bulkhead**: 50 connections per client by default
  (`quarkus.rest-client.connection-pool-size`). This demo raises it to 1000 (`CONNECTION_POOL_SIZE`)
  to match the model; with the default, calls to a dependency are served in waves of 50. In Fragor,
  model it as a `bulkhead` with `value: 50` and a `waitingTaskQueue`.
- `quarkus.thread-pool.queue-size` behaves like Fragor's `queueLimit`: 300 concurrent requests to
  payment (50 threads, queue 100) gave 50 + 50 + 50 served in FIFO waves and 150 immediate 503s.

### Fragor now models it

`timeout.enforcement: "caller-pool"` makes a timeout a task for the caller's worker pool, late when
the pool is busy and lost when its queue is full, with the read timeout as backstop (see
[SEMANTICS.md](../../docs/SEMANTICS.md), 6.5). The mirror scenarios use it where the real code uses
`@Timeout`; the `*-read-timeout.json` variants keep the default `"timer"`.

| | Real, `@Timeout` | Fragor, `fragor/baseline.json` (caller-pool) |
| --- | --- | --- |
| Baseline: success / failed | 71.8% / 28.2% | 70.5% / 29.5% |
| Baseline: p50 / p95 / p99 | 149 ms / 26.6 s / 28.0 s | 156 ms / 26.6 s / 28.0 s |
| Baseline: 503 at the gateway | 1,664 | 1,772 |
| Baseline: requests reaching payment | 4,266 | 4,250 |
| Breaker: success / degraded / failed | 38.3% / 33.4% / 28.3% | 37.9% / 32.5% / 29.5% |
| Breaker: p50 / p95 / p99 | 177 ms / 26.4 s / 27.9 s | 181 ms / 26.5 s / 28.0 s |

Fragor reports it as the finding *timeout-starvation*: for this demo, "22 timeouts ran late and 150
were lost because Order Service had no free worker".

To compare a real run with the right mirror, `load/experiment.sh` picks `fragor/baseline.json` or
`fragor/breaker.json`; for runs with `ORDER_PAYMENT_READ_TIMEOUT` / `GATEWAY_ORDER_READ_TIMEOUT`
set, it picks the `*-read-timeout.json` variants.

## Validation across loads and seeds (2026-10-07, repeated 2026-10-08)

`load/validate.sh` runs the real services at 50, 100 and 150 rps, with both timeout
configurations, three times each (18 runs, every service restarted before each run).
`load/validation-report.mjs` compares them with the mirror scenario at the same load over 10 seeds:
mean (min–max) on each side, and the gap between the means.

```bash
load/validate.sh 3 "50 100 150"          # about 25 minutes
node load/validation-report.mjs 10        # writes results/validation.md
```

Results with the mirrors as committed (`options.abandonedWork: "drop-queued"`, see below), real
runs of 2026-10-08 (gap = Fragor mean minus real mean):

| Configuration | Load | Success: real / Fragor | Gap | p50: real / Fragor | p95: real / Fragor | p99: real / Fragor |
| --- | --- | --- | --- | --- | --- | --- |
| `@Timeout` (caller-pool) | 50 rps | 89.5% / 89.4% | −0.1 pp | 282 / 290 ms | 23.9 s / 23.8 s | 26.1 s / 26.0 s |
| `@Timeout` (caller-pool) | 100 rps | 71.7% / 70.5% | −1.2 pp | 146 / 154 ms | 26.6 s / 26.6 s | 28.1 s / 28.0 s |
| `@Timeout` (caller-pool) | 150 rps | 65.9% / 64.3% | −1.6 pp | 130 / 136 ms | 27.8 s / 27.8 s | 29.0 s / 28.9 s |
| read-timeout (timer) | 50 rps | 49.5% / 49.3% | −0.2 pp | 317 / 320 ms | 4.3 s / 4.3 s | 4.5 s / 4.4 s |
| read-timeout (timer) | 100 rps | 49.4% / 49.3% | −0.1 pp | 365 / 377 ms | 2.8 s / 2.8 s | 4.4 s / 4.4 s |
| read-timeout (timer) | 150 rps | 57.2% / 57.4% | +0.2 pp | 2.2 s / 2.3 s | 5.8 s / 6.0 s | 7.2 s / 7.4 s |

Real runs were very repeatable (success varied by at most 0.4 points between repetitions) and so
were the seeds (at most 0.5 points). **The model now holds in all six combinations**: success
within 1.6 points, percentiles within 0.2 s.

How we got there. The first matrix (2026-10-07, mirrors without `abandonedWork`) matched the
`@Timeout` configuration but not the read-timeout one: tails about 2 s short at 50 and 100 rps,
and at 150 rps 49.0% success and p50 0.28 s against a real 57.2% and 2.2 s. A direct test found
why: with the provider slow, 300 concurrent requests to payment (50 threads, queue 100) from a
client that gives up after 2 s gave 150 immediate 503s, 50 requests that kept running after the
client left (orphaned work) and **100 queued requests that were discarded without running**: the
external provider received 50 calls, not 150. When the caller closes the connection, Quarkus does
not run the work still waiting in the queue, but finishes the work already running. Fragor had no
such mode (its default ran everything; `cancelOnTimeout` also stopped the running work), so we
added `options.abandonedWork: "drop-queued"` and set it in the four mirrors. Checked first against
the old real runs, then confirmed with this new matrix. The `@Timeout` rows do not change: there
the timeouts are late or lost, so nothing is discarded. Previous results are kept in
`results/validation-2026-10-07/` (not committed).
