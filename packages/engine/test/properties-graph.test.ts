import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ClientPolicies,
  createSimulation,
  type EdgeSpec,
  type FaultSpec,
  type NodeSpec,
  type Scenario,
  type Simulation,
} from "../src";

const policiesArb: fc.Arbitrary<ClientPolicies> = fc
  .record(
    {
      timeout: fc.record(
        {
          valueMs: fc.integer({ min: 5, max: 400 }),
          enforcement: fc.constantFrom("timer" as const, "caller-pool" as const),
        },
        { requiredKeys: ["valueMs"] },
      ),
      retry: fc.record({
        maxRetries: fc.integer({ min: 0, max: 3 }),
        delayMs: fc.integer({ min: 0, max: 100 }),
        jitterMs: fc.integer({ min: 0, max: 50 }),
        abortOn: fc.constantFrom(undefined, ["circuit-open" as const]),
      }),
      circuitBreaker: fc.record({
        requestVolumeThreshold: fc.integer({ min: 1, max: 10 }),
        failureRatio: fc.double({ min: 0, max: 1, noNaN: true }),
        delayMs: fc.integer({ min: 0, max: 500 }),
        successThreshold: fc.integer({ min: 1, max: 3 }),
      }),
      bulkhead: fc.record({
        value: fc.integer({ min: 1, max: 5 }),
        waitingTaskQueue: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
      }),
      fallback: fc.record({ countsAs: fc.constantFrom("degraded" as const, "success" as const) }),
    },
    { requiredKeys: [] },
  )
  .map((p) => JSON.parse(JSON.stringify(p)) as ClientPolicies); // drop undefined keys

const nodeArb = (id: string): fc.Arbitrary<NodeSpec> =>
  fc.record({
    id: fc.constant(id),
    name: fc.constant(id),
    kind: fc.constant("service" as const),
    workers: fc.integer({ min: 1, max: 6 }),
    queueLimit: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
    workerModel: fc.constantFrom("blocking" as const, "async" as const),
    serviceTime: fc.record({
      type: fc.constant("exponential" as const),
      meanMs: fc.integer({ min: 1, max: 60 }),
    }),
    errorRate: fc.double({ min: 0, max: 0.5, noNaN: true }),
    calls: fc.constant([]),
  });

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .integer({ min: 2, max: 4 })
  .chain((n) =>
    fc.record({
      seed: fc.integer(),
      cancelOnTimeout: fc.boolean(),
      nodes: fc.tuple(...Array.from({ length: n }, (_, i) => nodeArb(`n${i}`))),
      // edge from node i to some later node j (keeps the call graph acyclic)
      targets: fc.tuple(
        ...Array.from({ length: n - 1 }, (_, i) => fc.integer({ min: i + 1, max: n - 1 })),
      ),
      policies: fc.array(policiesArb, { minLength: n - 1, maxLength: n - 1 }),
      loss: fc.array(fc.double({ min: 0, max: 0.2, noNaN: true }), {
        minLength: n - 1,
        maxLength: n - 1,
      }),
      rps: fc.integer({ min: 1, max: 200 }),
      faultKind: fc.constantFrom("none", "latency", "error", "refuse", "blackhole", "traffic"),
    }),
  )
  .map((p) => {
    const nodes = p.nodes.map((x) => ({ ...x }));
    const edges: EdgeSpec[] = p.targets.map((to, i) => ({
      id: `e${i}`,
      from: `n${i}`,
      to: `n${to}`,
      latency: { type: "uniform", minMs: 0, maxMs: 5 },
      packetLoss: p.loss[i] ?? 0,
      policies: p.policies[i] ?? {},
    }));
    for (const e of edges) nodes.find((x) => x.id === e.from)?.calls.push({ edgeId: e.id });
    const faults: FaultSpec[] = [];
    const window = { id: "f", startMs: 300, durationMs: 700 };
    if (p.faultKind === "latency") {
      faults.push({
        ...window,
        target: { node: "n1" },
        effect: { type: "latency-add", add: { type: "constant", ms: 300 } },
      });
    } else if (p.faultKind === "error") {
      faults.push({ ...window, target: { node: "n1" }, effect: { type: "error-rate", rate: 1 } });
    } else if (p.faultKind === "refuse" || p.faultKind === "blackhole") {
      faults.push({
        ...window,
        target: { node: "n1" },
        effect: { type: "outage", mode: p.faultKind },
      });
    } else if (p.faultKind === "traffic") {
      faults.push({
        ...window,
        target: { traffic: "t" },
        effect: { type: "traffic-multiply", factor: 4 },
      });
    }
    const scenario: Scenario = {
      schemaVersion: 1,
      name: "graph-prop",
      seed: p.seed,
      durationMs: 2000,
      options: { drainMs: 3000, cancelOnTimeout: p.cancelOnTimeout },
      metrics: { bucketMs: 250 },
      nodes,
      edges,
      traffic: [{ id: "t", target: "n0", pattern: { type: "poisson", rps: p.rps } }],
      faults,
    };
    return scenario;
  });

describe("engine invariants on random call graphs (test group 13)", () => {
  it("time, events, workers, queues, bulkheads and conservation hold at every event", {
    timeout: 60_000,
  }, () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        let sim: Simulation | undefined;
        let lastT = 0;
        const seen = new Set<number>();
        const limits = new Map(scenario.nodes.map((n) => [n.id, n.queueLimit]));
        const bulkheads = new Map(scenario.edges.map((e) => [e.id, e.policies.bulkhead]));
        sim = createSimulation(scenario, {
          onEvent: (e) => {
            expect(e.timeMs).toBeGreaterThanOrEqual(lastT);
            lastT = e.timeMs;
            expect(seen.has(e.seq)).toBe(false);
            seen.add(e.seq);
            const snap = (sim as Simulation).snapshot();
            for (const [id, n] of Object.entries(snap.nodes)) {
              expect(n.busyWorkers).toBeLessThanOrEqual(n.effectiveWorkers);
              const limit = limits.get(id);
              if (limit !== null && limit !== undefined)
                expect(n.queueDepth).toBeLessThanOrEqual(limit);
              expect(n.arrivals).toBe(
                n.completed + n.queueDepth + n.inService + n.waitingOnDependencies,
              );
            }
            for (const [id, e] of Object.entries(snap.edges)) {
              expect(e.inFlight).toBeGreaterThanOrEqual(0);
              const bh = bulkheads.get(id);
              if (bh !== undefined) {
                expect(e.bulkheadRunning).toBeLessThanOrEqual(bh.value);
                expect(e.bulkheadQueued).toBeLessThanOrEqual(bh.waitingTaskQueue ?? 0);
              }
            }
            expect(snap.roots.arrived).toBe(snap.roots.completed + snap.roots.inFlight);
          },
        });
        const r = sim.finish();
        expect(r.stats.eventsProcessed).toBe(seen.size);
        const s = r.summary;
        expect(s.roots).toBe(s.success + s.degraded + s.failed + s.unfinished);
        expect(Object.values(s.failureReasons).reduce((a, b) => a + b, 0)).toBe(s.failed);
      }),
      { numRuns: 120 },
    );
  });
});
