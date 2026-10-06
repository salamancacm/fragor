import { describe, expect, it } from "vitest";
import type { ClientPolicies, SimulationResult } from "../src";
import { simulate } from "../src";
import { chain } from "./helpers";

const BREAKER = {
  requestVolumeThreshold: 10,
  failureRatio: 0.5,
  delayMs: 2000,
  successThreshold: 2,
};

/** Server is healthy (10 ms) except for +2 s from t = 2 s to t = 6 s; callers time out at 500 ms. */
function run(policies: ClientPolicies): SimulationResult {
  return simulate(
    chain({
      rps: 50,
      durationMs: 12_000,
      policies: { timeout: { valueMs: 500 }, circuitBreaker: BREAKER, ...policies },
      faults: [
        {
          id: "slow",
          startMs: 2000,
          durationMs: 4000,
          target: { node: "server" },
          effect: { type: "latency-add", add: { type: "constant", ms: 2000 } },
        },
      ],
    }),
  );
}

/** Latency of sampled roots whose every attempt was rejected by the open breaker. */
function rejectedOnly(r: SimulationResult): number[] {
  return r.traces
    .filter((t) => {
      const attempts = t.spans.filter((s) => s.kind === "attempt");
      return attempts.length > 0 && attempts.every((s) => s.failure === "circuit-open");
    })
    .map((t) => (t.endMs as number) - t.startMs);
}

describe("circuit breaker (test group 6)", () => {
  const r = run({});
  const transitions = r.events.breakerTransitions;
  const seq = transitions.map((t) => `${t.from}->${t.to}`);

  it("opens only after the window fills with failures >= failureRatio", () => {
    expect(seq[0]).toBe("closed->open");
    const firstOpen = transitions[0]?.tMs ?? 0;
    // Failures start as timeouts at about 2 s + 500 ms; 10 results are needed first.
    expect(firstOpen).toBeGreaterThan(2500);
    expect(firstOpen).toBeLessThan(3000);
  });

  it("fails fast while open: failure latency is far below the timeout", () => {
    const fast = rejectedOnly(r);
    expect(fast.length).toBeGreaterThan(10);
    for (const ms of fast) expect(ms).toBeLessThan(5);
    expect(r.summary.circuitOpen).toBeGreaterThan(0);
  });

  it("moves to half-open exactly delayMs after opening", () => {
    for (const [i, t] of transitions.entries()) {
      if (t.to !== "half-open") continue;
      const opened = transitions[i - 1];
      expect(opened?.to).toBe("open");
      expect(t.tMs - (opened?.tMs ?? 0)).toBeCloseTo(BREAKER.delayMs, 9);
    }
  });

  it("reopens on a half-open failure during the fault and closes after it ends", () => {
    expect(seq).toContain("half-open->open");
    const reopen = transitions.find((t) => t.from === "half-open" && t.to === "open");
    expect(reopen?.tMs).toBeLessThan(6500);
    expect(seq.at(-1)).toBe("half-open->closed");
    expect(transitions.at(-1)?.tMs).toBeGreaterThan(6000);
  });

  it("records the breaker state in the edge series", () => {
    const states = r.series.edges["c-s"]?.breakerState ?? [];
    expect(states[0]).toBe("closed");
    expect(states).toContain("open");
    expect(states.at(-1)).toBe("closed");
  });
});

describe("retry on an open breaker (test group 7)", () => {
  const retry = { maxRetries: 3, delayMs: 100, jitterMs: 0 };
  const retrying = run({ retry });
  const aborting = run({ retry: { ...retry, abortOn: ["circuit-open"] } });

  it("by default every root burns its retries against the open breaker", () => {
    const lat = rejectedOnly(retrying);
    expect(lat.length).toBeGreaterThan(10);
    for (const ms of lat) expect(ms).toBeGreaterThanOrEqual(3 * retry.delayMs);
  });

  it("with abortOn circuit-open, roots fail immediately", () => {
    const lat = rejectedOnly(aborting);
    expect(lat.length).toBeGreaterThan(10);
    for (const ms of lat) expect(ms).toBeLessThan(5);
    expect(aborting.summary.retries).toBeLessThan(retrying.summary.retries);
  });
});

describe("fallback", () => {
  it("turns failures into degraded (or success) results, never mixing them", () => {
    const degraded = run({ fallback: { countsAs: "degraded" } }).summary;
    expect(degraded.failed).toBe(0);
    expect(degraded.degraded).toBeGreaterThan(0);
    expect(degraded.degraded).toBe(degraded.fallbacks);
    const success = run({ fallback: { countsAs: "success" } }).summary;
    expect(success.degraded).toBe(0);
    expect(success.failed).toBe(0);
    expect(success.success).toBe(success.roots);
  });

  it("adds its latency when configured", () => {
    const r = run({ fallback: { countsAs: "degraded", latency: { type: "constant", ms: 50 } } });
    const degraded = r.traces.filter((t) => t.outcome === "degraded" && t.endMs !== null);
    expect(degraded.length).toBeGreaterThan(0);
    for (const t of degraded) expect((t.endMs as number) - t.startMs).toBeGreaterThanOrEqual(50);
  });
});
