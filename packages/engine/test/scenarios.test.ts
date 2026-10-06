import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSimulation, type SimulationResult, simulate } from "../src";
import { computeFingerprint } from "../src/metrics/summary";
import { example } from "./examples";

const FILES = readdirSync(join(import.meta.dirname, "..", "..", "scenarios", "examples"))
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("canonical scenarios", () => {
  it("there are six of them", () => {
    expect(FILES).toHaveLength(6);
  });

  for (const file of FILES) {
    describe(file, () => {
      const scenario = example(file);
      const r = simulate(scenario);

      it("runs to completion with consistent totals", () => {
        const s = r.summary;
        expect(s.roots).toBeGreaterThan(0);
        expect(s.roots).toBe(s.success + s.degraded + s.failed + s.unfinished);
        expect(Object.values(s.failureReasons).reduce((a, b) => a + b, 0)).toBe(s.failed);
        const perTraffic = Object.values(s.byTraffic).reduce((a, t) => a + t.roots, 0);
        expect(perTraffic).toBe(s.roots);
      });

      it("is deterministic and survives a JSON round trip", () => {
        expect(simulate(scenario).fingerprint).toBe(r.fingerprint);
        const parsed = JSON.parse(JSON.stringify(r)) as SimulationResult;
        expect(parsed).toEqual(r);
        const { fingerprint, ...rest } = parsed;
        expect(computeFingerprint(rest)).toBe(fingerprint);
      });
    });
  }
});

describe("payment-slow: breaker + fallback vs baseline", () => {
  const baseline = simulate(example("01-payment-slow-baseline.json"));
  const breaker = simulate(example("02-payment-slow-with-breaker.json"));

  it("baseline: retries amplify load on payment and the slowness cascades to failures", () => {
    const edge = baseline.series.edges["order-payment"];
    const invocations = (edge?.arrivals ?? []).reduce((a, b) => a + b, 0);
    const attempts = (edge?.attempts ?? []).reduce((a, b) => a + b, 0);
    expect(attempts).toBeGreaterThan(1.5 * invocations);
    expect(baseline.summary.failed).toBeGreaterThan(0);
    expect(Math.max(...(baseline.series.nodes.payment?.utilization ?? []))).toBeGreaterThan(0.99);
  });

  it("with breaker: the circuit opens and fallbacks turn failures into degraded results", () => {
    expect(breaker.events.breakerTransitions[0]?.to).toBe("open");
    expect(breaker.summary.failed).toBeLessThan(baseline.summary.failed);
    expect(breaker.summary.degraded).toBeGreaterThan(0);
    expect(breaker.summary.fallbacks).toBeGreaterThanOrEqual(breaker.summary.degraded);
  });

  it("with breaker: the gateway is protected from the cascade", () => {
    const busy = (r: SimulationResult) =>
      (r.series.nodes.gateway?.utilization ?? []).filter((u) => u > 0.9).length;
    expect(busy(breaker)).toBeLessThan(busy(baseline));
  });
});

describe("isolation (test group 15)", () => {
  it("interleaved multi-node simulations match separate runs", () => {
    const a = example("01-payment-slow-baseline.json");
    const b = example("02-payment-slow-with-breaker.json");
    const simA = createSimulation(a);
    const simB = createSimulation(b);
    for (let t = 0; t <= 130_000; t += 1000) {
      simA.runUntil(t);
      simB.runUntil(t + 500);
    }
    expect(simA.finish().fingerprint).toBe(simulate(a).fingerprint);
    expect(simB.finish().fingerprint).toBe(simulate(b).fingerprint);
  });
});
