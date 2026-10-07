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

## What we found (2026-10-07, one run each, 24-CPU machine, Docker Desktop)

| | Fragor model | Real services |
| --- | --- | --- |
| Baseline: success / failed | 48.9% / 51.1% | 71.6% / 28.4% |
| Baseline: p50 / p95 / p99 | 274 ms / 2.3 s / 2.4 s | 146 ms / 26.3 s / 27.8 s |
| Breaker: success / degraded / failed | 39.3% / 60.8% / 0.0% | 38.3% / 33.4% / 28.3% |
| Breaker: p50 / p95 / p99 | 280 ms / 656 ms / 2.3 s | 177 ms / 26.4 s / 27.9 s |

The model and reality disagree a lot. That is the point of this demo: each disagreement is an
assumption to understand. What has been checked so far:

**Confirmed to behave like the model**
- One request during the fault takes 8.36 s and fails: four attempts of 2 s plus retry delays,
  exactly what the model computes for `timeout 2000` + `maxRetries 3`.
- `quarkus.thread-pool.queue-size` works like `queueLimit`: 300 concurrent requests to payment
  (50 threads, queue 100) with the slow provider gave 50 + 50 + 50 served in FIFO waves and 150
  immediate 503s.
- CPU is not a factor: containers stayed under 12% CPU during the load.

**Found: a hidden bulkhead.** The Quarkus REST client has a connection pool of 50 connections per
client by default (`quarkus.rest-client.connection-pool-size`, documented default 50). It limits
concurrent calls to a dependency exactly like a bulkhead with a waiting queue, and the mirror model
had no such limit: with the defaults, order processed payment calls in waves of exactly 50. The
demo raises the pools to 1000 (`CONNECTION_POOL_SIZE`) so worker threads are the only limit, as in
the model. Run with `CONNECTION_POOL_SIZE=50` to see the default. In Fragor this is modeled as a
`bulkhead` (`value: 50` plus a `waitingTaskQueue`) on each edge.

**Still open (not explained yet)**
- With pools raised, about 28% of requests still fail and the tail is around 26-28 s, close to the
  30 s REST client read timeout, in both profiles. The logs show `RejectedExecutionException` at the
  gateway (its queue of 1000 fills up) and at order: their threads stay busy far longer than the
  model expects. Hypotheses to test next:
  - a synchronous `@Timeout` interrupts the caller thread, but the blocked call may not return until
    the response or the read timeout (the MicroProfile spec warns that interruption does not always
    stop blocking I/O), so the thread is held longer than the model assumes;
  - work queued in the Vert.x/HTTP layer before reaching the worker pool, outside `queue-size`;
  - per-service metrics (Micrometer/Prometheus) are needed to see where the time goes.
- k6 generates arrivals at a constant rate but drops iterations when it runs out of virtual users
  (about 100 per run here), so the real arrival count is slightly lower than the model's.

Until these are understood, read the Fragor numbers as the behavior of the *model*, and use the
differences to question your assumptions about the real system.
