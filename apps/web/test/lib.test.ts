import { simulate } from "@fragor/engine";
import { applyPatch } from "@fragor/scenarios";
import { describe, expect, it } from "vitest";
import { breakerRows, faultWindows, globalRows, nodeRows } from "../src/lib/chart-data";
import { EXAMPLES } from "../src/lib/examples";
import { COLUMN_WIDTH, layoutGraph } from "../src/lib/graph-layout";
import { edgeHealth, nodeHealth } from "../src/lib/health";
import { DEFAULT_BREAKER, paramsOf, patchFor } from "../src/lib/params";
import type { FromWorker } from "../src/lib/protocol";
import { horizonOf, runInChunks } from "../src/worker/run-loop";

const example = (file: string) => {
  const e = EXAMPLES.find((x) => x.file === file);
  if (e === undefined) throw new Error(`missing example ${file}`);
  return e.scenario;
};
const s01 = example("01-payment-slow-baseline");
const s02 = example("02-payment-slow-with-breaker");

describe("examples", () => {
  it("bundles the six canonical scenarios, validated", () => {
    expect(EXAMPLES.map((e) => e.file)).toEqual([
      "01-payment-slow-baseline",
      "02-payment-slow-with-breaker",
      "03-cascade-blast-radius",
      "04-cascade-with-bulkhead",
      "05-traffic-spike-10x",
      "06-retry-storm-jitter",
    ]);
  });
});

describe("params -> patch", () => {
  it("unchanged params produce no patch", () => {
    for (const e of EXAMPLES) expect(patchFor(e.scenario, paramsOf(e.scenario))).toEqual([]);
  });

  it("turning the breaker of 02 off and on round-trips through applyPatch", () => {
    const p = paramsOf(s02);
    const off = {
      ...p,
      edges: {
        ...p.edges,
        "order-payment": { timeoutMs: 2000, retries: 3, breaker: false },
      },
    };
    const noBreaker = applyPatch(s02, patchFor(s02, off));
    expect(
      noBreaker.edges.find((e) => e.id === "order-payment")?.policies.circuitBreaker,
    ).toBeUndefined();
    const on = {
      ...paramsOf(s01),
      edges: {
        ...paramsOf(s01).edges,
        "order-payment": { timeoutMs: 2000, retries: 3, breaker: true },
      },
    };
    const withBreaker = applyPatch(s01, patchFor(s01, on));
    expect(
      withBreaker.edges.find((e) => e.id === "order-payment")?.policies.circuitBreaker,
    ).toEqual(DEFAULT_BREAKER);
  });

  it("changes timeout and retries, and removes them", () => {
    const p = paramsOf(s01);
    const changed = {
      ...p,
      edges: { ...p.edges, "order-payment": { timeoutMs: 1500, retries: 1, breaker: false } },
    };
    const s = applyPatch(s01, patchFor(s01, changed));
    const edge = s.edges.find((e) => e.id === "order-payment");
    expect(edge?.policies.timeout).toEqual({ valueMs: 1500 });
    expect(edge?.policies.retry?.maxRetries).toBe(1);
    const removed = {
      ...p,
      edges: { ...p.edges, "order-payment": { timeoutMs: null, retries: 0, breaker: false } },
    };
    const s2 = applyPatch(s01, patchFor(s01, removed));
    expect(s2.edges.find((e) => e.id === "order-payment")?.policies).toEqual({});
  });

  it("scales every traffic pattern", () => {
    const s = applyPatch(s01, patchFor(s01, { ...paramsOf(s01), trafficFactor: 2 }));
    expect(s.traffic[0]?.pattern).toEqual({ type: "poisson", rps: 200 });
    const spike = example("05-traffic-spike-10x");
    const scaled = applyPatch(spike, patchFor(spike, { ...paramsOf(spike), trafficFactor: 0.5 }));
    expect(scaled.traffic[0]?.pattern).toMatchObject({ baseRps: 30, peakRps: 300 });
  });
});

describe("graph layout", () => {
  it("places callers left of their dependencies", () => {
    const pos = layoutGraph(s01);
    expect(pos.gateway?.x).toBe(0);
    expect(pos.order?.x).toBe(COLUMN_WIDTH);
    expect(pos["external-payment"]?.x).toBe(3 * COLUMN_WIDTH);
    const cascade = layoutGraph(example("03-cascade-blast-radius"));
    expect(cascade["user-service"]?.x).toBe(cascade["order-service"]?.x);
    expect(cascade["user-service"]?.y).not.toBe(cascade["order-service"]?.y);
  });
});

describe("health and chart data", () => {
  const r01 = simulate(s01);
  const r02 = simulate(s02);

  it("colors a saturated node critical and an idle bucket idle", () => {
    expect(nodeHealth(r01, "payment", 20).health).toBe("critical");
    expect(nodeHealth(r01, "payment", 2).health).toBe("healthy");
    expect(nodeHealth(r01, "gateway", r01.series.buckets + 5).health).toBe("idle");
  });

  it("an open breaker makes its edge critical", () => {
    const openAt = r02.series.edges["order-payment"]?.breakerState?.indexOf("open") ?? -1;
    expect(openAt).toBeGreaterThan(0);
    expect(edgeHealth(r02, "order-payment", openAt)).toMatchObject({
      health: "critical",
      breaker: "open",
    });
  });

  it("global rows overlay the previous run and stay plain numbers", () => {
    const rows = globalRows(r02, r01);
    expect(rows).toHaveLength(Math.max(r01.series.buckets, r02.series.buckets));
    expect(rows[20]?.prevP95).toBe(r01.series.global.p95Ms[20]);
    expect(rows[20]?.p95).toBe(r02.series.global.p95Ms[20]);
    for (const row of rows)
      for (const v of Object.values(row)) expect(v === null || Number.isFinite(v)).toBe(true);
  });

  it("per-node and breaker rows have one column per entity", () => {
    expect(Object.keys(nodeRows(r01, "utilization")[0] ?? {})).toEqual([
      "t",
      "gateway",
      "order",
      "payment",
      "external-payment",
    ]);
    const b = breakerRows(r02);
    expect(b.edges).toEqual(["order-payment"]);
    expect(b.rows.some((row) => row["order-payment"] === 2)).toBe(true);
    expect(faultWindows(s01)).toEqual([{ id: "external-slow", fromS: 10, toS: 40 }]);
  });
});

describe("worker run loop", () => {
  it("reports progress then the same result as simulate(), plus findings", async () => {
    const messages: FromWorker[] = [];
    await runInChunks(
      1,
      s01,
      (m) => messages.push(m),
      () => false,
      () => Promise.resolve(),
    );
    const progress = messages.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(10);
    const times = progress.map((m) => (m.type === "progress" ? m.nowMs : 0));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const done = messages.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.result.fingerprint).toBe(simulate(s01).fingerprint);
      expect(done.findings.length).toBeGreaterThan(0);
    }
    expect(horizonOf(s01)).toBe(120_000);
  });

  it("stops when cancelled", async () => {
    const messages: FromWorker[] = [];
    let n = 0;
    await runInChunks(
      2,
      s01,
      (m) => messages.push(m),
      () => ++n > 3,
      () => Promise.resolve(),
    );
    expect(messages.at(-1)).toEqual({ type: "cancelled", runId: 2 });
    expect(messages.some((m) => m.type === "done")).toBe(false);
  });

  it("reports engine errors as messages", async () => {
    const messages: FromWorker[] = [];
    await runInChunks(
      3,
      { ...s01, durationMs: -1 },
      (m) => messages.push(m),
      () => false,
      () => Promise.resolve(),
    );
    expect(messages).toEqual([
      { type: "error", runId: 3, message: "durationMs must be > 0, got -1" },
    ]);
  });
});
