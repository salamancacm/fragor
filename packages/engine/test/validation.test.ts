import { describe, expect, it } from "vitest";
import { createSimulation, simulate } from "../src";
import { node, singleNode, traffic } from "./helpers";

describe("engine-level validation", () => {
  it("rejects broken references and invalid values with clear messages", () => {
    const cases: [ReturnType<typeof singleNode>, RegExp][] = [
      [singleNode({ traffic: [traffic("web", "nope", 1)] }), /unknown node "nope"/],
      [singleNode({ nodes: [node("svc"), node("svc")] }), /duplicate id "svc" in nodes/],
      [singleNode({ nodes: [node("svc", { workers: 0 })] }), /workers must be an integer >= 1/],
      [singleNode({ nodes: [node("svc", { errorRate: 1.5 })] }), /errorRate must be in \[0, 1\]/],
      [singleNode({ nodes: [node("svc", { queueLimit: -1 })] }), /queueLimit must be null/],
      [singleNode({ durationMs: 0 }), /durationMs must be > 0/],
      [
        singleNode({ nodes: [node("svc", { serviceTime: { type: "constant", ms: -3 } })] }),
        /nodes\[svc\]\.serviceTime: ms must be/,
      ],
    ];
    for (const [scenario, message] of cases) expect(() => simulate(scenario)).toThrow(message);
  });

  it("fails explicitly on features scheduled for M2", () => {
    const withEdge = singleNode({
      nodes: [node("svc"), node("b")],
      edges: [
        {
          id: "a-b",
          from: "a",
          to: "b",
          latency: { type: "constant", ms: 1 },
          packetLoss: 0,
          policies: {},
        },
      ],
    });
    expect(() => simulate(withEdge)).toThrow(/^not implemented: edges/);
    expect(() =>
      simulate(singleNode({ nodes: [node("svc", { calls: [{ edgeId: "x" }] })] })),
    ).toThrow(/^not implemented: nodes\[svc\]\.calls/);
  });

  it("snapshot reports live state while streaming", () => {
    const sim = createSimulation(
      singleNode({
        nodes: [node("svc", { workers: 1, serviceTime: { type: "constant", ms: 50 } })],
      }),
    );
    sim.runUntil(1000);
    const snap = sim.snapshot();
    expect(sim.nowMs).toBe(1000);
    expect(snap.nowMs).toBe(1000);
    expect(snap.roots.arrived).toBeGreaterThan(0);
    expect(snap.nodes.svc?.busyWorkers).toBe(1);
    expect(snap.nodes.svc?.queueDepth).toBeGreaterThan(0);
    sim.finish();
    expect(() => sim.runUntil(2000)).toThrow(/already finished/);
  });
});
