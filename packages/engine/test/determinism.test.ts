import { describe, expect, it } from "vitest";
import { createSimulation, type SimulationResult, simulate } from "../src";
import { computeFingerprint } from "../src/metrics/summary";
import { node, singleNode, traffic } from "./helpers";

function withoutWallClock(r: SimulationResult): unknown {
  return { ...r, stats: { ...r.stats, wallClockMs: 0 } };
}

const busy = singleNode({
  nodes: [
    node("svc", {
      workers: 3,
      queueLimit: 20,
      errorRate: 0.1,
      serviceTime: {
        type: "mixture",
        components: [
          { weight: 9, dist: { type: "lognormal", p50Ms: 20, p99Ms: 90 } },
          { weight: 1, dist: { type: "uniform", minMs: 100, maxMs: 300 } },
        ],
      },
    }),
  ],
  traffic: [traffic("web", "svc", 120)],
});

describe("determinism (test group 1)", () => {
  it("same scenario and seed give the same fingerprint and identical result", () => {
    const a = simulate(busy);
    const b = simulate(busy);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(withoutWallClock(a)).toEqual(withoutWallClock(b));
  });

  it("a different seed gives a different fingerprint", () => {
    expect(simulate(busy).fingerprint).not.toBe(simulate({ ...busy, seed: 43 }).fingerprint);
  });

  it("runUntil in chunks gives the same result as a single run", () => {
    const sim = createSimulation(busy);
    for (let t = 0; t <= 80_000; t += 777) sim.runUntil(t);
    expect(sim.finish().fingerprint).toBe(simulate(busy).fingerprint);
  });

  it("does not mutate the scenario", () => {
    const copy = structuredClone(busy);
    simulate(busy);
    expect(busy).toEqual(copy);
  });
});

describe("serialization and isolation (test group 15)", () => {
  it("JSON round trip preserves structure and fingerprint", () => {
    const r = simulate(busy);
    const parsed = JSON.parse(JSON.stringify(r)) as SimulationResult;
    expect(parsed).toEqual(r);
    const { fingerprint, ...rest } = parsed;
    expect(computeFingerprint(rest)).toBe(fingerprint);
  });

  it("contains no NaN, Infinity or undefined anywhere", () => {
    const r = simulate(singleNode({ traffic: [] }));
    const walk = (v: unknown, path: string): void => {
      if (typeof v === "number") expect(Number.isFinite(v), path).toBe(true);
      else if (v === undefined) throw new Error(`undefined at ${path}`);
      else if (Array.isArray(v)) {
        for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`);
      } else if (v !== null && typeof v === "object") {
        expect(Object.getPrototypeOf(v), path).toBe(Object.prototype);
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      }
    };
    walk(r, "result");
    walk(simulate(busy), "result");
  });

  it("interleaved simulations match separate runs", () => {
    const other = { ...busy, seed: 7, name: "other" };
    const a = createSimulation(busy);
    const b = createSimulation(other);
    for (let t = 0; t <= 80_000; t += 500) {
      a.runUntil(t);
      b.runUntil(t + 250);
    }
    expect(a.finish().fingerprint).toBe(simulate(busy).fingerprint);
    expect(b.finish().fingerprint).toBe(simulate(other).fingerprint);
  });
});
