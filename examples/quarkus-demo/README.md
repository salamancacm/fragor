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
