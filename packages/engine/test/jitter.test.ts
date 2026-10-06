import { describe, expect, it } from "vitest";
import { type Scenario, simulate } from "../src";
import { example } from "./examples";

function withJitter(jitterMs: number): Scenario {
  const s = example("06-retry-storm-jitter.json");
  for (const e of s.edges) if (e.policies.retry !== undefined) e.policies.retry.jitterMs = jitterMs;
  return s;
}

function variance(xs: readonly number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
}

describe("retry storm and jitter (test group 11)", () => {
  const bucketMs = example("06-retry-storm-jitter.json").metrics?.bucketMs ?? 1000;
  // Retry window: from the first retries (burst at 5 s + 1 s) to 12 s.
  const window = (s: Scenario) =>
    (simulate(s).series.nodes.api?.arrivals ?? []).slice(6000 / bucketMs, 12_000 / bucketMs);
  const synced = window(withJitter(0));
  const spread = window(withJitter(500));

  it("without jitter retries arrive in bursts: higher variance per bucket", () => {
    expect(variance(synced)).toBeGreaterThan(4 * variance(spread));
  });

  it("without jitter the peak bucket is much higher", () => {
    expect(Math.max(...synced)).toBeGreaterThan(2 * Math.max(...spread));
  });

  it("jitter lets more of the burst succeed", () => {
    const burst = (j: number) => simulate(withJitter(j)).summary.byTraffic.burst;
    expect(burst(500)?.success).toBeGreaterThan(burst(0)?.success ?? 0);
  });
});
