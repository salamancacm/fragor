import { describe, expect, it } from "vitest";
import { type FaultEffect, type FaultTarget, simulate } from "../src";
import { chain } from "./helpers";

const sum = (xs: readonly number[] = []): number => xs.reduce((a, b) => a + b, 0);

let faultSeq = 0;
function fault(target: FaultTarget, effect: FaultEffect, startMs = 0, durationMs = 10_000) {
  return { id: `f${faultSeq++}`, startMs, durationMs, target, effect };
}

describe("network", () => {
  it("packet loss is resolved only by the timeout", () => {
    const s = chain({ policies: { timeout: { valueMs: 300 } } });
    const edge = s.edges[0];
    if (edge === undefined) throw new Error("missing edge");
    edge.packetLoss = 0.3;
    const r = simulate(s);
    // Each attempt needs both legs: P(success) = 0.7^2 = 0.49.
    const ratio = r.summary.success / r.summary.roots;
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.63);
    expect(r.summary.failureReasons.timeout).toBe(r.summary.failed);
    // The server only sees requests whose first leg arrived (about 70%).
    const seen = sum(r.series.nodes.server?.arrivals) / r.summary.roots;
    expect(seen).toBeGreaterThan(0.55);
    expect(seen).toBeLessThan(0.85);
    // Lost responses are not orphaned work: the job finished before the caller gave up.
    expect(r.summary.orphanedWork).toBe(0);
  });

  it("latency is sampled per leg and adds to end-to-end latency", () => {
    const r = simulate(chain({ server: { serviceTime: { type: "constant", ms: 10 } } }));
    expect(r.summary.p50Ms).toBeCloseTo(12, 6);
  });
});

describe("faults (FAULT_START / FAULT_END)", () => {
  it("records start and end events", () => {
    const r = simulate(
      chain({ faults: [fault({ node: "server" }, { type: "error-rate", rate: 1 }, 2000, 3000)] }),
    );
    const id = r.events.faults[0]?.id;
    expect(r.events.faults).toEqual([
      { tMs: 2000, id, phase: "start" },
      { tMs: 5000, id, phase: "end" },
    ]);
    expect(r.summary.failed).toBe(30);
  });

  it("error-rate: the most recently started fault wins while active", () => {
    const r = simulate(
      chain({
        faults: [
          fault({ node: "server" }, { type: "error-rate", rate: 1 }, 0, 10_000),
          fault({ node: "server" }, { type: "error-rate", rate: 0 }, 4000, 2000),
        ],
      }),
    );
    expect(r.summary.success).toBe(20);
    expect(r.summary.failed).toBe(80);
  });

  it("latency-add sums overlapping faults; latency-multiply multiplies", () => {
    const add = simulate(
      chain({
        faults: [
          fault({ node: "server" }, { type: "latency-add", add: { type: "constant", ms: 100 } }),
          fault({ node: "server" }, { type: "latency-add", add: { type: "constant", ms: 50 } }),
        ],
      }),
    );
    expect(add.summary.p50Ms).toBeCloseTo(162, 6);
    const mul = simulate(
      chain({
        faults: [
          fault({ node: "server" }, { type: "latency-multiply", factor: 3 }),
          fault({ edge: "c-s" }, { type: "latency-multiply", factor: 2 }),
        ],
      }),
    );
    expect(mul.summary.p50Ms).toBeCloseTo(34, 6);
  });

  it("outage refuse fails fast with connection-refused; blackhole leaves only timeouts", () => {
    const policies = { timeout: { valueMs: 400 } };
    const refuse = simulate(
      chain({ policies, faults: [fault({ node: "server" }, { type: "outage", mode: "refuse" })] }),
    );
    expect(refuse.summary.failureReasons["connection-refused"]).toBe(100);
    expect(refuse.summary.p99Ms).toBeLessThan(5);
    const hole = simulate(
      chain({
        policies,
        faults: [fault({ node: "server" }, { type: "outage", mode: "blackhole" })],
      }),
    );
    expect(hole.summary.failureReasons.timeout).toBe(100);
    expect(sum(hole.series.nodes.server?.arrivals)).toBe(0);
  });

  it("capacity reduces effective workers while active", () => {
    const r = simulate(
      chain({
        rps: 100,
        server: { workers: 4, serviceTime: { type: "constant", ms: 20 } },
        faults: [fault({ node: "server" }, { type: "capacity", workersFactor: 0.5 }, 2000, 4000)],
      }),
    );
    const util = r.series.nodes.server?.utilization ?? [];
    // 100 rps x 20 ms = 2 busy workers: 50% of 4, 100% of 2.
    expect(util[1]).toBeCloseTo(0.5, 1);
    expect(util[4]).toBeGreaterThan(0.95);
  });

  it("traffic-multiply scales the arrival rate", () => {
    const r = simulate(
      chain({
        faults: [fault({ traffic: "web" }, { type: "traffic-multiply", factor: 3 }, 2000, 2000)],
      }),
    );
    expect(r.series.global.arrivals.slice(0, 6)).toEqual([10, 10, 30, 30, 10, 10]);
  });

  it("edge packet-loss faults combine with the edge's own loss", () => {
    const r = simulate(
      chain({
        policies: { timeout: { valueMs: 300 } },
        faults: [fault({ edge: "c-s" }, { type: "packet-loss", rate: 1 }, 0, 5000)],
      }),
    );
    expect(r.summary.failed).toBe(50);
    expect(r.summary.success).toBe(50);
  });
});
