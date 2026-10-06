import { describe, expect, it } from "vitest";
import { createSimulation, type Scenario, simulate } from "../src";
import { chain, node, singleNode, traffic } from "./helpers";

function withEdge(mutate: (s: Scenario) => void): Scenario {
  const s = chain();
  mutate(s);
  return s;
}

describe("engine-level validation", () => {
  it("rejects broken references and invalid values with clear messages", () => {
    const cases: [Scenario, RegExp][] = [
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

  it("validates edges, calls and policies", () => {
    const cases: [Scenario, RegExp][] = [
      [
        withEdge((s) => ((s.edges[0] as Scenario["edges"][0]).to = "x")),
        /edges\[c-s\]\.to references unknown node "x"/,
      ],
      [
        withEdge((s) => ((s.edges[0] as Scenario["edges"][0]).packetLoss = 2)),
        /packetLoss must be in \[0, 1\]/,
      ],
      [
        withEdge((s) => ((s.nodes[0] as Scenario["nodes"][0]).calls = [{ edgeId: "zz" }])),
        /calls\[0\]\.edgeId references unknown edge "zz"/,
      ],
      [
        withEdge((s) => ((s.nodes[1] as Scenario["nodes"][0]).calls = [{ edgeId: "c-s" }])),
        /edge "c-s" starts at "client", not at "server"/,
      ],
      [
        withEdge((s) => {
          (s.edges[0] as Scenario["edges"][0]).policies.retry = {
            maxRetries: 1.5,
            delayMs: 0,
            jitterMs: 0,
          };
        }),
        /retry\.maxRetries must be an integer >= 0/,
      ],
      [
        withEdge((s) => {
          (s.edges[0] as Scenario["edges"][0]).policies.circuitBreaker = {
            requestVolumeThreshold: 0,
            failureRatio: 0.5,
            delayMs: 1,
            successThreshold: 1,
          };
        }),
        /requestVolumeThreshold must be an integer >= 1/,
      ],
      [
        withEdge((s) => {
          (s.edges[0] as Scenario["edges"][0]).policies.retry = {
            maxRetries: 3,
            delayMs: 100,
            jitterMs: 0,
            backoffFactor: 2,
            maxDelayMs: 50,
          };
        }),
        /delayMs \(100\) must be < maxDelayMs \(50\)/,
      ],
      [
        withEdge((s) => {
          s.faults = [
            {
              id: "f",
              startMs: 0,
              durationMs: 1,
              target: { edge: "c-s" },
              effect: { type: "capacity", workersFactor: 1 },
            },
          ];
        }),
        /effect "capacity" is not allowed for target kind "edge"/,
      ],
      [
        withEdge((s) => {
          s.faults = [
            {
              id: "f",
              startMs: 0,
              durationMs: 1,
              target: { node: "nope" },
              effect: { type: "error-rate", rate: 1 },
            },
          ];
        }),
        /target references unknown node "nope"/,
      ],
    ];
    for (const [scenario, message] of cases) expect(() => simulate(scenario)).toThrow(message);
  });

  it("rejects call cycles", () => {
    const s = withEdge((sc) => {
      sc.edges.push({
        id: "s-c",
        from: "server",
        to: "client",
        latency: { type: "constant", ms: 1 },
        packetLoss: 0,
        policies: {},
      });
      (sc.nodes[1] as Scenario["nodes"][0]).calls = [{ edgeId: "s-c" }];
    });
    expect(() => simulate(s)).toThrow(/call cycle detected: client -> server -> client/);
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

  it("snapshot reports edge state", () => {
    const sim = createSimulation(
      chain({
        server: { serviceTime: { type: "constant", ms: 500 } },
        policies: {
          bulkhead: { value: 2, waitingTaskQueue: 3 },
          circuitBreaker: {
            requestVolumeThreshold: 5,
            failureRatio: 0.5,
            delayMs: 100,
            successThreshold: 1,
          },
        },
      }),
    );
    sim.runUntil(450);
    const edge = sim.snapshot().edges["c-s"];
    expect(edge?.bulkheadRunning).toBe(2);
    expect(edge?.bulkheadQueued).toBe(3);
    expect(edge?.inFlight).toBe(5);
    expect(edge?.breakerState).toBe("closed");
  });
});
