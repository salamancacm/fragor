import { describe, expect, it } from "vitest";
import { simulate, type TrafficPattern } from "../src";
import { singleNode } from "./helpers";

/** Root arrivals per bucket for a fast, never-saturated node. */
function arrivals(pattern: TrafficPattern, durationMs = 60_000, seed = 1): number[] {
  const scenario = singleNode({
    seed,
    durationMs,
    traffic: [{ id: "t", target: "svc", pattern }],
  });
  scenario.nodes[0] = {
    ...(scenario.nodes[0] as (typeof scenario.nodes)[0]),
    workers: 10_000,
    queueLimit: null,
    serviceTime: { type: "constant", ms: 1 },
  };
  return simulate(scenario).series.global.arrivals.slice(0, Math.ceil(durationMs / 1000));
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe("traffic patterns", () => {
  it("constant produces exactly rps * seconds evenly spaced arrivals", () => {
    const xs = arrivals({ type: "constant", rps: 100 });
    expect(sum(xs)).toBe(6000);
    expect(new Set(xs)).toEqual(new Set([100]));
  });

  it("poisson count is within 4 standard deviations of rps * seconds", () => {
    const n = sum(arrivals({ type: "poisson", rps: 100 }));
    expect(Math.abs(n - 6000)).toBeLessThan(4 * Math.sqrt(6000));
  });

  it("ramp follows the integral of its rate and increases over time", () => {
    const xs = arrivals({ type: "ramp", fromRps: 0, toRps: 200, durationMs: 60_000 });
    expect(Math.abs(sum(xs) - 6000)).toBeLessThan(4 * Math.sqrt(6000));
    expect(sum(xs.slice(30))).toBeGreaterThan(2 * sum(xs.slice(0, 30)));
  });

  it("spike holds the peak rate and returns to base", () => {
    const xs = arrivals({
      type: "spike",
      baseRps: 50,
      peakRps: 500,
      atMs: 20_000,
      holdMs: 10_000,
      rampMs: 2_000,
    });
    const base = sum(xs.slice(0, 20)) / 20;
    const peak = sum(xs.slice(22, 30)) / 8;
    const after = sum(xs.slice(35)) / 25;
    expect(Math.abs(base - 50)).toBeLessThan(10);
    expect(Math.abs(peak - 500)).toBeLessThan(40);
    expect(Math.abs(after - 50)).toBeLessThan(10);
  });

  it("respects startMs and endMs", () => {
    const scenario = singleNode({
      traffic: [
        {
          id: "t",
          target: "svc",
          startMs: 2000,
          endMs: 5000,
          pattern: { type: "constant", rps: 10 },
        },
      ],
    });
    const xs = simulate(scenario).series.global.arrivals;
    expect(xs.slice(0, 2)).toEqual([0, 0]);
    expect(xs.slice(2, 5)).toEqual([10, 10, 10]);
    expect(sum(xs.slice(5))).toBe(0);
  });

  it("rejects negative rates", () => {
    expect(() =>
      simulate(
        singleNode({
          traffic: [{ id: "t", target: "svc", pattern: { type: "poisson", rps: -1 } }],
        }),
      ),
    ).toThrow(/rps must be a finite number >= 0/);
  });
});
