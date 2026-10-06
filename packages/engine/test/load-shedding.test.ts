import { describe, expect, it } from "vitest";
import { simulate } from "../src";
import { node, singleNode, traffic } from "./helpers";

/** 2 workers x 20 ms constant = 100 rps capacity; offered 150 rps. */
function overload(queueLimit: number | null, drainMs = 60_000) {
  return simulate(
    singleNode({
      durationMs: 20_000,
      options: { drainMs },
      nodes: [node("svc", { workers: 2, queueLimit, serviceTime: { type: "constant", ms: 20 } })],
      traffic: [traffic("web", "svc", 150)],
    }),
  );
}

describe("queue and load shedding (test group 8)", () => {
  it("a finite queue under overload rejects with 503 and never exceeds its limit", () => {
    const r = overload(30);
    expect(r.summary.rejected503).toBeGreaterThan(0);
    expect(r.summary.failureReasons["http-5xx"]).toBe(r.summary.rejected503);
    const maxDepth = Math.max(...(r.series.nodes.svc?.queueDepthMax ?? []));
    expect(maxDepth).toBeLessThanOrEqual(30);
    expect(maxDepth).toBe(30);
    // Shedding keeps latency bounded: at most (queue + workers) x service time.
    expect(r.summary.p99Ms).toBeLessThanOrEqual(((30 + 2) / 2) * 20 + 20);
  });

  it("an unbounded queue never rejects and grows without limit", () => {
    const r = overload(null, 0);
    expect(r.summary.rejected503).toBe(0);
    const depth = r.series.nodes.svc?.queueDepthAvg ?? [];
    expect(depth[19]).toBeGreaterThan(depth[4] as number);
    expect(depth[19]).toBeGreaterThan(500);
    expect(r.summary.unfinished).toBeGreaterThan(500);
  });

  it("queueLimit 0 rejects whenever all workers are busy", () => {
    const r = overload(0);
    expect(Math.max(...(r.series.nodes.svc?.queueDepthMax ?? []))).toBe(0);
    expect(r.summary.rejected503).toBeGreaterThan(0);
  });

  it("utilization is saturated under overload and bounded by 1", () => {
    const util = overload(30).series.nodes.svc?.utilization ?? [];
    for (const u of util.slice(1, 19)) expect(u).toBeGreaterThan(0.99);
    for (const u of util) expect(u).toBeLessThanOrEqual(1);
  });
});
