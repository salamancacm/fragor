# Engine semantics

Every rule the engine implements, its source and the test that covers it.

**Status legend**
- `pending`: rule specified in the brief, not implemented yet.
- `UNVERIFIED`: behavior could not be checked against official documentation.
- Rules claimed equivalent to MicroProfile Fault Tolerance / SmallRye / Quarkus must cite an
  official URL once verified. Nothing is claimed as equivalent before that.

Sources to consult in M2:
- MicroProfile Fault Tolerance specification
- SmallRye Fault Tolerance documentation
- Quarkus REST Client documentation (default read timeout)

| # | Rule | Source | Test | Status |
| --- | --- | --- | --- | --- |
| 6.1 | Virtual time; heap ordered by (timeMs, seq); no wall clock in logic | n/a (design) | M1 | pending |
| 6.2 | Seeded PRNG, per-entity sub-streams, distribution sampling, Poisson thinning | n/a (design) | M1 | pending |
| 6.3 | Call composition Fallback(Retry(CircuitBreaker(Timeout(Bulkhead(attempt))))) | MP-FT spec | M2 | pending |
| 6.4 | Blocking vs async workers; FIFO queue | n/a (design) | M2 | pending |
| 6.5 | Timeout leaves orphaned work; `cancelOnTimeout` behavior; default edge timeout | Quarkus REST Client docs | M2 | pending |
| 6.6 | Retry: retryOn/abortOn, backoff, jitter, maxDuration; retries on circuit-open by default | SmallRye FT docs | M2 | pending |
| 6.7 | Circuit breaker states, sliding window, half-open, success threshold | MP-FT spec / SmallRye | M2 | pending |
| 6.8 | Bulkhead semaphore and waiting queue | MP-FT spec | M2 | pending |
| 6.9 | Fallback classified as degraded or success, never mixed | n/a (product) | M2 | pending |
| 6.10 | Network latency and packet loss per leg | n/a (design) | M2 | pending |
| 6.11 | Fault effects and combination rules | n/a (design) | M2 | pending |
| 6.12 | Root requests inherit rootId and route | n/a (design) | M1 | pending |
| 6.13 | Root outcome: success, degraded, failed, unfinished | n/a (design) | M1 | pending |
| 6.14 | Metrics buckets, log-linear histogram, sampled traces | n/a (design) | M1/M2 | pending |

This table is completed milestone by milestone with URLs and test file names.
