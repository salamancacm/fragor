import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createSimulation,
  type Dist,
  type Scenario,
  type Simulation,
  type TrafficPattern,
} from "../src";

const distArb: fc.Arbitrary<Dist> = fc.oneof(
  fc.record({
    type: fc.constant("constant" as const),
    ms: fc.double({ min: 0, max: 50, noNaN: true }),
  }),
  fc.record({
    type: fc.constant("exponential" as const),
    meanMs: fc.double({ min: 0.5, max: 50, noNaN: true }),
  }),
  fc
    .tuple(
      fc.double({ min: 0.5, max: 30, noNaN: true }),
      fc.double({ min: 1, max: 10, noNaN: true }),
    )
    .map(([p50Ms, k]): Dist => ({ type: "lognormal", p50Ms, p99Ms: p50Ms * k })),
  fc
    .tuple(fc.double({ min: 0, max: 20, noNaN: true }), fc.double({ min: 0, max: 20, noNaN: true }))
    .map(([a, b]): Dist => ({ type: "uniform", minMs: Math.min(a, b), maxMs: Math.max(a, b) })),
);

const patternArb: fc.Arbitrary<TrafficPattern> = fc.oneof(
  fc.record({ type: fc.constant("constant" as const), rps: fc.integer({ min: 0, max: 400 }) }),
  fc.record({ type: fc.constant("poisson" as const), rps: fc.integer({ min: 0, max: 400 }) }),
  fc.record({
    type: fc.constant("ramp" as const),
    fromRps: fc.integer({ min: 0, max: 300 }),
    toRps: fc.integer({ min: 0, max: 300 }),
    durationMs: fc.integer({ min: 0, max: 3000 }),
  }),
  fc.record({
    type: fc.constant("spike" as const),
    baseRps: fc.integer({ min: 0, max: 100 }),
    peakRps: fc.integer({ min: 0, max: 600 }),
    atMs: fc.integer({ min: 0, max: 2000 }),
    holdMs: fc.integer({ min: 0, max: 1000 }),
    rampMs: fc.integer({ min: 0, max: 500 }),
  }),
);

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    seed: fc.integer(),
    durationMs: fc.integer({ min: 100, max: 3000 }),
    bucketMs: fc.integer({ min: 50, max: 1000 }),
    drainMs: fc.integer({ min: 0, max: 2000 }),
    workers: fc.integer({ min: 1, max: 8 }),
    queueLimit: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
    errorRate: fc.double({ min: 0, max: 1, noNaN: true }),
    serviceTime: distArb,
    patterns: fc.array(patternArb, { minLength: 1, maxLength: 2 }),
  })
  .map((p) => ({
    schemaVersion: 1,
    name: "prop",
    seed: p.seed,
    durationMs: p.durationMs,
    options: { drainMs: p.drainMs },
    metrics: { bucketMs: p.bucketMs },
    nodes: [
      {
        id: "svc",
        name: "svc",
        kind: "service",
        workers: p.workers,
        queueLimit: p.queueLimit,
        workerModel: "blocking",
        serviceTime: p.serviceTime,
        errorRate: p.errorRate,
        calls: [],
      },
    ],
    edges: [],
    traffic: p.patterns.map((pattern, i) => ({ id: `t${i}`, target: "svc", pattern })),
    faults: [],
  }));

describe("engine invariants (test group 13)", () => {
  it("time never goes back, no event runs twice, workers and queue stay within limits", {
    timeout: 60_000,
  }, () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        let sim: Simulation | undefined;
        let lastT = 0;
        const seen = new Set<number>();
        const limit = scenario.nodes[0]?.queueLimit ?? null;
        sim = createSimulation(scenario, {
          onEvent: (e) => {
            expect(e.timeMs).toBeGreaterThanOrEqual(lastT);
            lastT = e.timeMs;
            expect(seen.has(e.seq)).toBe(false);
            seen.add(e.seq);
            const n = (sim as Simulation).snapshot().nodes.svc;
            if (n === undefined) throw new Error("missing node snapshot");
            expect(n.busyWorkers).toBeLessThanOrEqual(n.effectiveWorkers);
            if (limit !== null) expect(n.queueDepth).toBeLessThanOrEqual(limit);
          },
        });
        const r = sim.finish();
        expect(r.stats.eventsProcessed).toBe(seen.size);
        const s = r.summary;
        expect(s.roots).toBe(s.success + s.degraded + s.failed + s.unfinished);
      }),
      { numRuns: 150 },
    );
  });
});
