import type { Rng } from "../core/rng";
import type { FailureKind, Ms, RetryPolicy } from "../model/types";

/** SmallRye @Retry default maxDuration (180 000 ms). */
export const DEFAULT_RETRY_MAX_DURATION_MS = 180_000;
/** SmallRye @ExponentialBackoff default maxDelay (60 000 ms). */
export const DEFAULT_BACKOFF_MAX_DELAY_MS = 60_000;

/** Whether `failure` may be retried according to abortOn (wins) and retryOn (default: all). */
export function isRetryable(policy: RetryPolicy, failure: FailureKind): boolean {
  if (policy.abortOn?.includes(failure) === true) return false;
  return policy.retryOn === undefined || policy.retryOn.includes(failure);
}

/** maxRetries -1 means unlimited; maxDurationMs <= 0 means unlimited (as in SmallRye). */
export function canRetry(
  policy: RetryPolicy,
  failure: FailureKind,
  retriesDone: number,
  elapsedMs: Ms,
): boolean {
  if (policy.maxRetries !== -1 && retriesDone >= policy.maxRetries) return false;
  if (!isRetryable(policy, failure)) return false;
  return !maxDurationReached(policy, elapsedMs);
}

export function maxDurationReached(policy: RetryPolicy, elapsedMs: Ms): boolean {
  const max = policy.maxDurationMs ?? DEFAULT_RETRY_MAX_DURATION_MS;
  return max > 0 && elapsedMs >= max;
}

/**
 * Delay before retry number `n` (0-based), following SmallRye 6.11:
 * - constant: delay + jitter, never below 0;
 * - exponential (backoffFactor set): the first delay is delay + jitter; later ones are
 *   clamp(delay * factor^n + jitter, 0, maxDelay). With delayMs 0 the delay never grows.
 * Jitter is uniform in [-jitterMs, +jitterMs] (continuous; SmallRye draws integer ms).
 * The jitter draw always happens, so changing jitterMs never shifts the stream.
 */
export function retryDelay(policy: RetryPolicy, n: number, rng: Rng): Ms {
  const jitter = (rng.next() * 2 - 1) * policy.jitterMs;
  const factor = policy.backoffFactor;
  if (factor === undefined || n === 0 || policy.delayMs === 0) {
    return Math.max(0, policy.delayMs + jitter);
  }
  const configuredMax = policy.maxDelayMs ?? DEFAULT_BACKOFF_MAX_DELAY_MS;
  const maxDelay = configuredMax <= 0 ? Number.POSITIVE_INFINITY : configuredMax;
  const base = policy.delayMs * factor ** n;
  return Math.min(maxDelay, Math.max(0, base + jitter));
}
