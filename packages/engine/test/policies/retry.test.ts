import { describe, expect, it } from "vitest";
import { createStream, FAILURE_KINDS, type RetryPolicy } from "../../src";
import { canRetry, isRetryable, retryDelay } from "../../src/policies/retry";

const base: RetryPolicy = { maxRetries: 3, delayMs: 100, jitterMs: 0 };

describe("retry decision (SmallRye semantics)", () => {
  it("retries every failure kind by default, including circuit-open", () => {
    for (const k of FAILURE_KINDS) expect(isRetryable(base, k)).toBe(true);
  });

  it("abortOn takes precedence over retryOn", () => {
    const p: RetryPolicy = {
      ...base,
      retryOn: ["timeout", "circuit-open"],
      abortOn: ["circuit-open"],
    };
    expect(isRetryable(p, "timeout")).toBe(true);
    expect(isRetryable(p, "circuit-open")).toBe(false);
    expect(isRetryable(p, "http-5xx")).toBe(false);
  });

  it("stops at maxRetries; -1 means unlimited", () => {
    expect(canRetry(base, "timeout", 2, 0)).toBe(true);
    expect(canRetry(base, "timeout", 3, 0)).toBe(false);
    expect(canRetry({ ...base, maxRetries: -1 }, "timeout", 1_000_000, 0)).toBe(true);
  });

  it("stops once elapsed >= maxDuration (default 180 000 ms; <= 0 unlimited)", () => {
    expect(canRetry(base, "timeout", 0, 179_999)).toBe(true);
    expect(canRetry(base, "timeout", 0, 180_000)).toBe(false);
    expect(canRetry({ ...base, maxDurationMs: 500 }, "timeout", 0, 500)).toBe(false);
    expect(canRetry({ ...base, maxDurationMs: 0 }, "timeout", 0, 1e9)).toBe(true);
  });
});

describe("retry delay", () => {
  it("constant delay plus jitter in [-jitter, +jitter], never negative", () => {
    const rng = createStream(1, "retry");
    const p: RetryPolicy = { ...base, delayMs: 100, jitterMs: 150 };
    let sawZero = false;
    for (let i = 0; i < 5000; i++) {
      const d = retryDelay(p, i % 4, rng);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(250);
      if (d === 0) sawZero = true;
    }
    expect(sawZero).toBe(true);
  });

  it("exponential backoff: delay, delay*f, delay*f^2 ... capped at maxDelay", () => {
    const rng = createStream(1, "retry");
    const p: RetryPolicy = { ...base, delayMs: 100, backoffFactor: 2, maxDelayMs: 500 };
    expect([0, 1, 2, 3, 4].map((n) => retryDelay(p, n, rng))).toEqual([100, 200, 400, 500, 500]);
  });

  it("exponential backoff defaults maxDelay to 60 000 ms; 0 means unbounded", () => {
    const rng = createStream(1, "retry");
    const p: RetryPolicy = { ...base, delayMs: 1000, backoffFactor: 10 };
    expect(retryDelay(p, 3, rng)).toBe(60_000);
    expect(retryDelay({ ...p, maxDelayMs: 0 }, 3, rng)).toBe(1_000_000);
  });

  it("a zero initial delay never grows (as in SmallRye)", () => {
    const rng = createStream(1, "retry");
    expect(retryDelay({ ...base, delayMs: 0, backoffFactor: 2 }, 5, rng)).toBe(0);
  });
});
