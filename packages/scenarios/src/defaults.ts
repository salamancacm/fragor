import type { CircuitBreakerPolicy, RetryPolicy } from "@fragor/engine";

/**
 * SmallRye @CircuitBreaker defaults (docs/SEMANTICS.md 6.7), used when a breaker is added to an edge
 * without parameters (the web UI, imports of running services).
 */
export const DEFAULT_BREAKER: CircuitBreakerPolicy = {
  requestVolumeThreshold: 20,
  failureRatio: 0.5,
  delayMs: 5000,
  successThreshold: 1,
};

/** SmallRye @Retry defaults (delay 0, jitter 200 ms), used when retries are added to an edge. */
export const DEFAULT_RETRY: Omit<RetryPolicy, "maxRetries"> = { delayMs: 0, jitterMs: 200 };
