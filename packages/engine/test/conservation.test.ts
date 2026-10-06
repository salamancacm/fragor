import { describe, expect, it } from "vitest";
import { createSimulation, type Scenario, type Simulation, simulate } from "../src";
import { example } from "./examples";
import { node, singleNode, traffic } from "./helpers";

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function checkEveryEvent(scenario: Scenario): number {
  let checks = 0;
  let sim: Simulation | undefined;
  sim = createSimulation(scenario, {
    onEvent: () => {
      const snap = (sim as Simulation).snapshot();
      for (const n of Object.values(snap.nodes)) {
        expect(n.arrivals).toBe(n.completed + n.queueDepth + n.inService + n.waitingOnDependencies);
      }
      expect(snap.roots.arrived).toBe(snap.roots.completed + snap.roots.inFlight);
      checks++;
    },
  });
  sim.finish();
  return checks;
}

describe("conservation (test group 3)", () => {
  const overloaded = singleNode({
    nodes: [node("svc", { workers: 2, queueLimit: 15, errorRate: 0.2 })],
    traffic: [traffic("web", "svc", 150)],
  });

  it("roots = success + degraded + failed + unfinished", () => {
    for (const drainMs of [0, 60_000]) {
      const s = simulate({ ...overloaded, options: { drainMs } }).summary;
      expect(s.roots).toBe(s.success + s.degraded + s.failed + s.unfinished);
      if (drainMs === 0) expect(s.unfinished).toBeGreaterThan(0);
      else expect(s.unfinished).toBe(0);
    }
  });

  it("failure reasons add up to failed roots", () => {
    const s = simulate(overloaded).summary;
    expect(sum(Object.values(s.failureReasons))).toBe(s.failed);
  });

  it("node arrivals = completed + queued + in service at every event", () => {
    expect(checkEveryEvent(overloaded)).toBeGreaterThan(1000);
    expect(checkEveryEvent({ ...overloaded, options: { drainMs: 0 } })).toBeGreaterThan(1000);
  });

  it("series totals match the summary", () => {
    const r = simulate(overloaded);
    const g = r.series.global;
    expect(sum(g.arrivals)).toBe(r.summary.roots);
    expect(sum(g.success)).toBe(r.summary.success);
    expect(sum(g.failed)).toBe(r.summary.failed);
    const svc = r.series.nodes.svc;
    expect(svc).toBeDefined();
    if (svc === undefined) return;
    expect(sum(svc.arrivals)).toBe(r.summary.roots);
    expect(sum(svc.rejected503)).toBe(r.summary.rejected503);
    for (const arr of Object.values(svc))
      if (Array.isArray(arr)) expect(arr).toHaveLength(r.series.buckets);
  });
});

describe("conservation across the call graph (test group 3)", () => {
  for (const file of [
    "01-payment-slow-baseline.json",
    "02-payment-slow-with-breaker.json",
    "03-cascade-blast-radius.json",
  ]) {
    it(`${file}: node arrivals = completed + queued + in service + waiting, at every event`, () => {
      expect(checkEveryEvent(example(file))).toBeGreaterThan(10_000);
    });
  }

  it("holds with async workers and cancelOnTimeout", () => {
    const s = example("03-cascade-blast-radius.json");
    for (const n of s.nodes) n.workerModel = "async";
    s.options = { cancelOnTimeout: true };
    for (const e of s.edges) e.policies.timeout = { valueMs: 1500 };
    expect(checkEveryEvent(s)).toBeGreaterThan(10_000);
  });
});
