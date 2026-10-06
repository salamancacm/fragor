import { describe, expect, it } from "vitest";
import { compileDist, createStream, type Dist } from "../../src";
import { Z99 } from "../../src/core/distributions";
import { quantileSorted, relErr } from "../helpers";

const N = 200_000;

function samples(dist: Dist, n = N, seed = 2024): number[] {
  const sample = compileDist(dist);
  const rng = createStream(seed, "dist-test");
  return Array.from({ length: n }, () => sample(rng)).sort((a, b) => a - b);
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Tolerance: 4 standard errors of the sample quantile, in log space (where a lognormal is
 * normal). SE(q) = sigma * sqrt(q(1-q)) / (phi(z_q) * sqrt(n)), phi = standard normal pdf.
 * Documented in SEMANTICS.md.
 */
function logQuantileTolerance(sigma: number, q: number, z: number, n: number): number {
  const phi = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  return (4 * sigma * Math.sqrt(q * (1 - q))) / (phi * Math.sqrt(n));
}

describe("distributions (test group 12)", () => {
  it("lognormal reproduces p50 and p99 within 4 standard errors", () => {
    for (const [p50Ms, p99Ms] of [
      [120, 400],
      [10, 40],
      [5, 5000],
    ] as const) {
      const xs = samples({ type: "lognormal", p50Ms, p99Ms });
      const sigma = (Math.log(p99Ms) - Math.log(p50Ms)) / Z99;
      const p50Err = Math.abs(Math.log(quantileSorted(xs, 0.5) / p50Ms));
      const p99Err = Math.abs(Math.log(quantileSorted(xs, 0.99) / p99Ms));
      expect(p50Err).toBeLessThanOrEqual(logQuantileTolerance(sigma, 0.5, 0, N));
      expect(p99Err).toBeLessThanOrEqual(logQuantileTolerance(sigma, 0.99, Z99, N));
    }
    // For the canonical external API (p50 120 ms, p99 400 ms) that is about 0.6% and 1.7%.
    expect(logQuantileTolerance(Math.log(400 / 120) / Z99, 0.5, 0, N)).toBeLessThan(0.007);
  });

  it("lognormal with p99 == p50 is constant", () => {
    const xs = samples({ type: "lognormal", p50Ms: 7, p99Ms: 7 }, 1000);
    for (const x of xs) expect(x).toBeCloseTo(7, 9);
  });

  it("constant always returns its value", () => {
    expect(new Set(samples({ type: "constant", ms: 5 }, 1000))).toEqual(new Set([5]));
  });

  it("uniform stays in bounds with the right mean", () => {
    const xs = samples({ type: "uniform", minMs: 10, maxMs: 30 });
    expect(xs[0]).toBeGreaterThanOrEqual(10);
    expect(xs[xs.length - 1]).toBeLessThan(30);
    expect(relErr(mean(xs), 20)).toBeLessThan(0.01);
  });

  it("normal is truncated at 0 and keeps its mean when far from 0", () => {
    const near = samples({ type: "normal", meanMs: 1, stdMs: 5 });
    expect(near[0]).toBeGreaterThanOrEqual(0);
    const far = samples({ type: "normal", meanMs: 100, stdMs: 10 });
    expect(relErr(mean(far), 100)).toBeLessThan(0.005);
    expect(relErr(quantileSorted(far, 0.5), 100)).toBeLessThan(0.005);
  });

  it("exponential has the configured mean", () => {
    const xs = samples({ type: "exponential", meanMs: 50 });
    expect(relErr(mean(xs), 50)).toBeLessThan(0.01);
    expect(relErr(quantileSorted(xs, 0.5), 50 * Math.LN2)).toBeLessThan(0.02);
  });

  it("mixture picks components by normalized weight", () => {
    const xs = samples({
      type: "mixture",
      components: [
        { weight: 3, dist: { type: "constant", ms: 1 } },
        { weight: 1, dist: { type: "constant", ms: 1000 } },
      ],
    });
    const slow = xs.filter((x) => x === 1000).length / xs.length;
    expect(Math.abs(slow - 0.25)).toBeLessThan(0.005);
  });

  it("rejects invalid parameters with clear errors", () => {
    const bad: [Dist, RegExp][] = [
      [{ type: "constant", ms: -1 }, /ms must be a finite number >= 0/],
      [{ type: "uniform", minMs: 5, maxMs: 1 }, /maxMs \(1\) < minMs \(5\)/],
      [{ type: "lognormal", p50Ms: 0, p99Ms: 10 }, /p50Ms must be > 0/],
      [{ type: "lognormal", p50Ms: 10, p99Ms: 5 }, /p99Ms \(5\) must be >= p50Ms \(10\)/],
      [{ type: "exponential", meanMs: 0 }, /meanMs must be > 0/],
      [{ type: "normal", meanMs: -5, stdMs: 1 }, /meanMs must be a finite number >= 0/],
      [{ type: "mixture", components: [] }, /at least one component/],
      [
        { type: "mixture", components: [{ weight: 0, dist: { type: "constant", ms: 1 } }] },
        /components\[0\].*weight must be > 0/,
      ],
      [{ type: "constant", ms: Number.NaN }, /finite/],
    ];
    for (const [dist, message] of bad) expect(() => compileDist(dist, "x")).toThrow(message);
  });
});
