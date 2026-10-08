# Engine semantics

Every rule the engine implements, where it comes from and the test that covers it.

**Status legend**
- `verified`: checked against the official source listed in the rule, and tested.
- `design`: Fragor's own modeling choice. It makes no claim about any framework.
- `UNVERIFIED`: modeled on a framework, but the exact behavior could not be confirmed.

Test paths are relative to `packages/engine/test/`.

## Sources consulted (2026-10-06)

| Id | Source |
| --- | --- |
| [MPFT] | MicroProfile Fault Tolerance 4.1.2 specification — https://download.eclipse.org/microprofile/microprofile-fault-tolerance-4.1.2/microprofile-fault-tolerance-spec-4.1.2.html |
| [SR-multiple] | SmallRye Fault Tolerance 6.11.4, "How to Use Multiple Strategies" — https://smallrye.io/docs/smallrye-fault-tolerance/6.11.4/howto/multiple.html |
| [SR-cb] | SmallRye FT 6.11.4, Circuit Breaker reference — https://smallrye.io/docs/smallrye-fault-tolerance/6.11.4/reference/circuit-breaker.html |
| [SR-retry] | SmallRye FT 6.11.4, Retry reference (incl. backoff) — https://smallrye.io/docs/smallrye-fault-tolerance/6.11.4/reference/retry.html |
| [SR-bulkhead] | SmallRye FT 6.11.4, Bulkhead reference — https://smallrye.io/docs/smallrye-fault-tolerance/6.11.4/reference/bulkhead.html |
| [SR-timeout] | SmallRye FT 6.11.4, Timeout reference — https://smallrye.io/docs/smallrye-fault-tolerance/6.11.4/reference/timeout.html |
| [SR-src] | SmallRye FT 6.11.4 source, `implementation/core/.../circuit/breaker/{CircuitBreaker,BitsetRollingWindow}.java`, `.../retry/{Retry,ExponentialBackOff,RandomJitter}.java` — https://github.com/smallrye/smallrye-fault-tolerance/tree/6.11.4/implementation/core/src/main/java/io/smallrye/faulttolerance/core |
| [Q-rest] | Quarkus REST Client guide, configuration reference — https://quarkus.io/guides/rest-client |

## 6.1 Time and events — design

- Virtual time in milliseconds (float). The kernel is a binary heap ordered by `(timeMs, seq)`;
  `seq` is a monotonic counter, so simultaneous events run in scheduling order.
  Tests: `core/event-queue.test.ts`, `properties.test.ts`, `properties-graph.test.ts`.
- Scheduling in the past throws; time never goes back; no event runs twice.
- Cancelled events stay in the heap and are skipped (lazy cancellation).
- Event kinds: TRAFFIC_ARRIVAL, ARRIVE_AT_NODE, SERVICE_DONE, RESPONSE_AT_CALLER,
  TIMEOUT_FIRED, RETRY_DUE, FALLBACK_DONE, BREAKER_HALF_OPEN_DUE, FAULT_START, FAULT_END,
  METRICS_TICK.
- No wall clock or ambient randomness in simulation logic; `core/clock.ts` only feeds
  `stats.wallClockMs`. Test: `purity.test.ts`.

## 6.2 RNG and distributions — design

- PRNG sfc32 seeded from cyrb128(seed, path). Independent sub-streams per entity and purpose:
  `node/<id>/{service,error,calls,fault-latency}`, `edge/<id>/{latency,loss,fault-latency,policy}`,
  `traffic/<id>/arrivals`. Adding an entity never shifts another entity's draws.
  Tests: `core/rng.test.ts`, `stream-independence.test.ts`.
- Draws that depend on a parameter value are always made (error decision, call probability,
  packet loss, retry jitter), so changing that parameter does not shift the stream.
- `constant`; `uniform` on `[minMs, maxMs)`; `exponential` = `-mean * ln(U)`; `normal` with
  the Marsaglia polar method, **truncated** at 0 by rejection (requires `meanMs >= 0`);
  `lognormal` with `mu = ln(p50)`, `sigma = (ln(p99) - ln(p50)) / 2.3263`; `mixture` by normalized
  weights. `ln` and `exp` are `detLog` / `detExp` (core/math.ts), see the last section.
- Validation errors name the field path. Test: `core/distributions.test.ts`.
- **Tolerance of test 12:** with n = 200 000 samples and a fixed seed, sampled lognormal p50 and
  p99 lie within 4 standard errors of the target quantile in log space,
  `SE(q) = sigma * sqrt(q(1-q)) / (phi(z_q) * sqrt(n))` (about 0.6% for p50 and 1.7% for p99 with
  p50 = 120 ms, p99 = 400 ms).

## 6.3 Call lifecycle and composition — verified

- Policies nest as `Fallback(Retry(CircuitBreaker(Timeout(Bulkhead(attempt)))))`. This is the
  order documented by [SR-multiple] (without RateLimit, which Fragor does not model).
  [MPFT] is consistent: "the circuit breaker is checked before attempting to enter the bulkhead";
  [SR-bulkhead]: "the timeout watcher is started before enforcing the concurrency limit", so
  time spent waiting for the bulkhead counts toward the timeout. Code: `runtime/call-pipeline.ts`.
- One attempt: breaker check (rejection = `circuit-open`, no network) -> start timeout watcher ->
  bulkhead (`bulkhead-full` when rejected) -> request leg -> node outage check -> node admission
  -> processing -> response leg. The attempt result feeds breaker, retry and fallback.
- Each retry attempt passes through the breaker, the timeout and the bulkhead again, as
  [MPFT] and [SR-cb] state ("each retry attempt is processed by the circuit breaker").
  Tests: `timeout-orphans.test.ts`, `circuit-breaker.test.ts`.
- **Failure kind vs root cause (design):** a caller observes a failed dependency of its callee as
  `http-5xx` (the callee answers 500), and its own policies react to that kind. Separately the
  root cause (the kind where the failure originated, e.g. `timeout` on a deeper edge) is carried
  through 500 responses and is what `summary.failureReasons` counts.

## 6.4 Workers and queues — design

- Admission: start if `busy < effectiveWorkers`; else FIFO queue if
  `queueLimit === null || queueDepth < queueLimit`; else immediate 503 (`http-5xx`,
  `rejected503`). Test: `load-shedding.test.ts`.
- Processing: `serviceTime` (plus node latency faults); then with probability `errorRate`
  (or the fault override) a 500; otherwise `calls` in sequence. A call is skipped when `routes`
  excludes the root's route or the probability draw fails. A failed call with
  `required: false` does not fail (nor degrade) the parent; a degraded call (fallback) makes the
  parent's answer degraded.
- **blocking** (default): the worker is held during `serviceTime` and while waiting for
  dependencies. **async**: the worker is released after `serviceTime`; the job waits for its
  dependencies without a worker. Test: `cascade.test.ts` (test group 9).
- Utilization = integral(busy) / integral(effective workers) per bucket.

## 6.5 Timeout and orphaned work — verified (default value) / design (model)

- Attempt deadline: the edge's `timeout.valueMs`, else `options.defaultEdgeTimeoutMs`, else
  30 000 ms. **30 000 ms is the default of `quarkus.rest-client.read-timeout` [Q-rest]**
  (`quarkus.rest-client.connect-timeout` defaults to 15 000 ms; Fragor does not model connect
  time separately). Fragor applies only one deadline per attempt: when an edge has a timeout
  policy, the REST client read timeout is not modeled on top of it.
- On timeout the caller fails with `timeout` and moves on (retry, fallback). By default the
  server is not told: queued and running work continues, including its own downstream calls,
  and is counted as `orphanedWork` when it completes; its late response is counted as
  `orphanedResponses`. [MPFT] notes that a timed-out execution may keep running and "the
  execution result will be discarded"; [SR-timeout] states there is no cancellation for
  asynchronous executions. Tests: `timeout-orphans.test.ts` (test groups 4 and 5).
- `options.cancelOnTimeout: true` (design): the timed-out attempt cancels its server-side job:
  - queued at the node: removed, never runs;
  - in its own `serviceTime`: runs to the end (cannot be interrupted), then stops without
    making calls or replying;
  - waiting on dependencies: the current downstream invocation is cancelled (recursively: its
    attempt's job is cancelled the same way, pending retries are dropped) and the worker or
    waiting slot is freed immediately;
  - a request still on the wire is dropped when it arrives.
  Cancelled work never replies and is not counted as orphaned. Test: `timeout-orphans.test.ts`.
  `options.abandonedWork: "cancel"` is the same mode; `"continue"` is the default above.
- `options.abandonedWork: "drop-queued"` — **observed on real services (2026-10-08), mechanism
  UNVERIFIED**: when the caller times out, work still waiting in the server's queue is discarded
  when a worker reaches it (it takes no worker time and never replies, counted as `discardedWork`).
  Work already running goes on as orphaned work, including its downstream calls. A discarded
  request keeps its queue slot until a worker reaches it (design choice, UNVERIFIED: whether
  Quarkus frees the slot when the connection closes was not observed separately). Observed in
  examples/quarkus-demo with the payment provider slow: 300 concurrent requests to payment
  (50 worker threads, queue 100) from a client with a 2 s read timeout gave 150 immediate 503s,
  50 requests that kept running after the client left and 100 queued requests that never ran (the
  provider received 50 calls). Which Quarkus component skips them was not traced in the source.
  The mirror scenarios use this mode; see the validation below. Test: `abandoned-work.test.ts`.
- A lost response (packet loss) after the job finished is not orphaned work: the work ended
  before the caller gave up. Test: `network-faults.test.ts`.
- **Timeout enforcement — verified against real services (2026-10-07).** `timeout.enforcement`:
  - `"timer"` (default): the timeout fires at the deadline. Matches the Quarkus REST client
    `read-timeout`, enforced by Vert.x on the event loop.
  - `"caller-pool"`: at the deadline the interruption becomes a task for the **calling node's
    worker pool**, as a synchronous SmallRye `@Timeout` in Quarkus: SmallRye's `Timeout` schedules
    `timeoutAndInterrupt` on its timer
    ([Timeout.java](https://github.com/smallrye/smallrye-fault-tolerance/blob/6.11.4/implementation/core/src/main/java/io/smallrye/faulttolerance/core/timeout/Timeout.java)),
    whose thread submits due tasks to the async executor
    ([ThreadTimer.java](https://github.com/smallrye/smallrye-fault-tolerance/blob/6.11.4/implementation/core/src/main/java/io/smallrye/faulttolerance/core/timer/ThreadTimer.java),
    [ExecutorHolder.java](https://github.com/smallrye/smallrye-fault-tolerance/blob/6.11.4/implementation/fault-tolerance/src/main/java/io/smallrye/faulttolerance/ExecutorHolder.java)),
    and Quarkus provides its worker pool as that executor
    ([QuarkusAsyncExecutorProvider.java](https://github.com/quarkusio/quarkus/blob/3.40.1/extensions/smallrye-fault-tolerance/runtime/src/main/java/io/quarkus/smallrye/faulttolerance/runtime/QuarkusAsyncExecutorProvider.java)).
    Model: with a free worker the task runs at once; otherwise it waits in the node's FIFO queue
    behind the requests already there (a **late** timeout, counted in `timeoutsDelayed`); when the
    queue is full it is rejected (a **lost** timeout, `timeoutsLost`; the real log line is
    `SRFTL11000 ... RejectedExecutionException`). The task takes no service time, shares
    `queueLimit` with requests and is not counted in `queueDepth`. A task whose attempt already
    ended does nothing when it runs. Timeout tasks never reach nodes without a worker pool.
  - `"caller-pool"` keeps `options.defaultEdgeTimeoutMs` (the REST client read timeout, 30 s by
    default) as an independent backstop when it is later than `valueMs`.
  - `@Retry` delays and the breaker's move to half-open are not affected: SmallRye sleeps on the
    calling thread for synchronous retries, and the breaker re-checks its delay lazily on the next
    call.
  - Validation (examples/quarkus-demo, mirror scenarios in `examples/quarkus-demo/fragor`): with
    `@Timeout` the real services gave 71.8% success, p95 26.6 s, 1,664 gateway rejections and 4,266
    requests to payment; the model with `"caller-pool"` gives 70.5%, 26.6 s, 1,772 and 4,250. With
    the read-timeout the real services gave 49.5% and the model with `"timer"` 48.9% (49.3% once
    `abandonedWork: "drop-queued"` was added, 2026-10-08). Across
    loads and seeds see examples/quarkus-demo/README.md ("Validation across loads and seeds").
  Tests: `timeout-enforcement.test.ts`, `properties-graph.test.ts`.

## 6.6 Retry — verified

- Retry when the failure is not in `abortOn` (which wins) and is in `retryOn` (default: every
  kind), retries remain (`maxRetries`, `-1` = unlimited) and `maxDuration` is not reached
  [SR-retry], [MPFT].
- **Default `retryOn` includes `circuit-open`.** SmallRye's default `retryOn` is
  `{Exception.class}`, which includes `CircuitBreakerOpenException` [SR-retry]; [MPFT]:
  "If a CircuitBreakerOpenException is thrown, the execution may be retried". Exclude it with
  `abortOn: ["circuit-open"]`. Test: `circuit-breaker.test.ts` (test group 7).
- `maxDurationMs` defaults to 180 000 ms; `<= 0` means unlimited. Elapsed time is measured from
  the first attempt and checked when deciding to retry and again after the delay, before the
  next attempt [SR-src: Retry.java].
- Delay before retry `n` (0-based): `delayMs + jitter`, never below 0. Jitter is uniform in
  `[-jitterMs, +jitterMs]` [MPFT], [SR-retry]. Fragor draws it as a continuous value; SmallRye
  draws whole milliseconds [SR-src: RandomJitter.java].
- Exponential backoff (`backoffFactor`, SmallRye @ExponentialBackoff): first delay
  `delayMs + jitter`; then `clamp(delayMs * factor^n + jitter, 0, maxDelayMs)`; `maxDelayMs`
  defaults to 60 000 ms and `0` means no limit; with `delayMs = 0` the delay never grows
  [SR-retry], [SR-src: ExponentialBackOff.java]. SmallRye's factor is an integer; Fragor accepts
  any number >= 1 (non-integer factors have no SmallRye equivalent). Validation requires
  `delayMs < maxDelayMs` as SmallRye does. Test: `policies/retry.test.ts`.

## 6.7 Circuit breaker — verified

- One breaker per edge (caller -> dependency), like SmallRye's per-method singleton state.
- CLOSED: rolling window of the last `requestVolumeThreshold` results; evaluated only when full;
  opens when `failures >= ceil(failureRatio * requestVolumeThreshold)` [SR-src:
  CircuitBreaker.java, BitsetRollingWindow.java]. The [MPFT] examples (window 4, ratio 0.5: two
  failures open it) are reproduced in `policies/circuit-breaker.test.ts`.
- OPEN: attempts fail immediately with `circuit-open`, without touching the network; these
  rejections are not recorded in any window. After `delayMs` the breaker moves to HALF_OPEN
  (BREAKER_HALF_OPEN_DUE) [MPFT], [SR-cb].
- HALF_OPEN: admits at most `successThreshold` probe attempts; further attempts are rejected
  with `circuit-open` [SR-cb: "the number of probe invocations allowed"; SR-src: probeAttempts].
  Any probe failure reopens; `successThreshold` probe successes close it [MPFT], [SR-cb].
- Every transition resets the records; closing starts a fresh window [MPFT]: "Circuit breaker
  state transitions will reset the Circuit Breaker's records".
- A result is recorded only against the state it was admitted in; late results from a previous
  state are ignored [SR-src: compareAndSet on the state object].
- `failOn` (default: every kind) decides which failures count; timeouts and bulkhead
  rejections count by default, since they happen inside the breaker [MPFT].
- A cancelled half-open probe (cancelOnTimeout) frees its probe slot — **UNVERIFIED**: SmallRye
  has no equivalent cancellation path; this choice prevents a breaker from staying half-open
  forever.
- Transitions are recorded in `events.breakerTransitions` and the state per bucket in the edge
  series. Tests: `policies/circuit-breaker.test.ts`, `circuit-breaker.test.ts` (test group 6).

## 6.8 Bulkhead — verified (semaphore) / design (release time)

- At most `value` concurrent attempts per edge; excess attempts fail with `bulkhead-full`
  [MPFT], [SR-bulkhead].
- `waitingTaskQueue`: excess attempts wait in FIFO order and are rejected when the queue is full.
  In MicroProfile/SmallRye the queue only exists for `@Asynchronous` methods [MPFT],
  [SR-bulkhead]; Fragor applies it whenever it is configured (the caller's sync/async style is not
  modeled). A timeout while queued removes the attempt from the queue; it never starts [MPFT].
- The slot is released when the attempt resolves from the caller's view: response, timeout or
  cancellation (design, semaphore style). [MPFT] states that with `@Asynchronous` a timed-out
  execution still counts as running until it returns; Fragor does not model that variant.
  Tests: `policies/bulkhead.test.ts`, `cascade.test.ts` (test group 10).

## 6.9 Fallback — verified (trigger) / design (classification)

- The fallback runs when the inner composition (retries included) ends in failure, for any
  failure kind, including `circuit-open` and `bulkhead-full` [MPFT], [SR-multiple].
- Its answer takes `latency` (optional) and counts as `degraded` or `success` according to
  `countsAs`. The two are never merged: `degraded` roots are not goodput. Test:
  `circuit-breaker.test.ts` (fallback).

## 6.10 Network — design

- Each leg (request, response) samples `edge.latency`, then applies edge latency faults, then
  packet loss: `P(lost) = 1 - (1 - packetLoss) * prod(1 - faultRate)`. A lost request never
  reaches the server; a lost response never reaches the caller. Only the timeout resolves them.
  No extra reordering. Test: `network-faults.test.ts`.

## 6.11 Faults — design

- FAULT_START / FAULT_END at `startMs` and `startMs + durationMs`, recorded in `events.faults`.
- Allowed effects: node: `latency-add`, `latency-multiply`, `error-rate`, `outage`, `capacity`;
  edge: `latency-add`, `latency-multiply`, `packet-loss`, `outage`; traffic: `traffic-multiply`.
- Combination of overlapping faults on one target: `latency-add` sums samples, multiplicative
  effects multiply, `error-rate`: the most recently started active fault wins, `outage`:
  `blackhole` wins over `refuse`, `packet-loss`: independent losses.
- Node latency effects apply to `serviceTime`: `(serviceTime + sum(add)) * prod(factor)`.
- Node outage: `refuse` answers `connection-refused` through the response leg; `blackhole` never
  answers. Edge outage: `refuse` returns `connection-refused` after the request leg; `blackhole`
  drops the request. A root arriving at a blackholed entry node stays `unfinished`.
- `capacity`: effective workers = `floor(workers * prod(workersFactor))`, at least 1 unless the
  factor is 0. Running jobs are not preempted when capacity drops, so busy workers can exceed
  effective workers until they finish (utilization > 1 in that bucket).
- `traffic-multiply` scales the rate; on change the pending arrival is redrawn from the current
  time (exact for Poisson processes); constant patterns re-anchor at the last arrival.
  Test: `network-faults.test.ts`.

## 6.12 Traffic and roots — design

- Each arrival creates a root `r<n>` (creation order) with `route` and `createdAt`; descendant
  jobs inherit them.
- `constant`: arrival k at `startMs + k * 1000 / rps`. `poisson`: exponential inter-arrivals.
  `ramp`: linear `fromRps -> toRps` over `durationMs` from the source's `startMs`, then `toRps`.
  `spike`: `baseRps`; from `atMs` (absolute) linear up to `peakRps` over `rampMs` (default 0),
  hold `holdMs`, linear down over `rampMs`. Variable rates use thinning with the segment maximum.
  Arrivals happen on `[startMs, min(endMs, durationMs))`. Test: `traffic.test.ts`.

## 6.13 Root outcome — design

- `success | degraded | failed | unfinished`; `failed` carries the root cause (6.3).
  `unfinished` = in flight at `durationMs + drainMs` (default drain 60 000 ms).
- Conservation: `roots = success + degraded + failed + unfinished`; per node at every event
  `arrivals = completed + queued + in service + waiting on dependencies` (cancelled jobs count as
  completed). Tests: `conservation.test.ts`, `properties-graph.test.ts`.
- Summary latency covers every completed root (success, degraded, failed) and includes retries
  and waits; `null` when none completed. `goodputRps = success / (durationMs / 1000)`.
- `summary.byTraffic` gives the same outcome counts per traffic source.

## 6.14 Metrics and traces — design

- Bucket `i` covers `[i * bucketMs, (i + 1) * bucketMs)`; every bucket spans a full bucketMs.
- Percentiles: log-linear histogram over integer nanoseconds (128 sub-buckets per octave),
  bucket midpoint clamped to the observed min/max; relative error <= 0.5% for values >= 0.001 ms
  (half a bucket plus 1 ns). Test: `core/histogram.test.ts`.
- Node series: arrivals, success/degraded/failed responses, rejected503, residence-time
  percentiles, queue depth avg/max, utilization, orphanedWork. Edge series: invocations
  (`arrivals`), invocation outcomes and latency (retries included), attempts, retries, timeouts,
  circuitOpen, bulkheadFull, fallbacks, orphanedResponses, breaker state. Global series: root
  arrivals, outcomes and end-to-end latency, plus the sums of every counter.
- Traces: deterministic bottom-k sampling (the `maxTraces` roots with the smallest
  `hash(seed, rootId)`). Spans: `root -> job -> invocation -> attempt -> job -> ...`, plus
  `retry-wait` and `fallback`; attempts carry their index; jobs and attempts are flagged
  `orphaned` or `cancelled`. Parent links preserve causality between attempts.
- `fingerprint`: cyrb128 of the canonical JSON of the result without `stats.wallClockMs`.
  Tests: `determinism.test.ts`, `scenarios.test.ts` (test groups 1 and 15).

## Cross-engine determinism — design, verified

ECMAScript lets engines approximate `Math.log`, `Math.exp`, `Math.cos` and `Math.pow`, and Node and
Chrome were observed to differ in the last bit (different fingerprint for scenario 01). The engine
therefore uses `detLog` / `detExp` (core/math.ts: basic arithmetic and exact bit manipulation, about
2 ulp accuracy), the Marsaglia polar method for normal samples (no trigonometry), repeated
multiplication for integer powers, and `Math.sqrt` / `Math.floor` / `Math.imul` / `Math.clz32`,
which are exact. A purity test forbids the platform transcendental functions and `**` in the engine.
Verified on 2026-10-06: the six canonical scenarios give the same fingerprints in Node 22, Node 24
and a Chrome Web Worker. Tests: `core/math.test.ts`, `purity.test.ts`.
