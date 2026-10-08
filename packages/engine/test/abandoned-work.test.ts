import { describe, expect, it } from "vitest";
import { simulate } from "../src";
import { chain } from "./helpers";

// 5 workers x 1 s = 5 rps of capacity, 10 rps offered, callers give up after 500 ms.
const base = {
  rps: 10,
  server: { workers: 5, serviceTime: { type: "constant", ms: 1000 } as const },
  policies: { timeout: { valueMs: 500 } },
};
const sum = (xs: readonly number[] | undefined) => (xs ?? []).reduce((a, b) => a + b, 0);

describe('options.abandonedWork: "drop-queued"', () => {
  const keep = simulate(chain(base));
  const drop = simulate(chain({ ...base, options: { abandonedWork: "drop-queued" } }));

  it("running work goes on (orphaned), queued work of a departed caller is discarded", () => {
    expect(drop.summary.failureReasons.timeout).toBe(100);
    expect(drop.summary.orphanedWork).toBeGreaterThan(0);
    expect(drop.summary.discardedWork).toBeGreaterThan(0);
    // Every request either ran to the end or was discarded from the queue.
    expect(drop.summary.orphanedWork + drop.summary.discardedWork).toBe(100);
    expect(sum(drop.series.nodes.server?.discardedWork)).toBe(drop.summary.discardedWork);
  });

  it("the default runs everything and discards nothing", () => {
    expect(keep.summary.orphanedWork).toBe(100);
    expect(keep.summary.discardedWork).toBe(0);
  });

  it("no backlog: the server goes idle soon after the last caller left", () => {
    const busy = (drop.series.nodes.server?.utilization ?? []).slice(12, 19);
    for (const u of busy) expect(u).toBe(0);
  });

  it("discarded jobs are flagged as cancelled in traces and never reply", () => {
    const spans = drop.traces.flatMap((t) => t.spans).filter((s) => s.kind === "job");
    expect(spans.some((s) => s.cancelled)).toBe(true);
    expect(drop.summary.orphanedResponses).toBe(drop.summary.orphanedWork);
  });

  it("downstream calls of running work are not cancelled", () => {
    const withDb = (abandonedWork: "drop-queued" | "cancel") => {
      const s = chain({ ...base, options: { abandonedWork } });
      s.nodes.push({
        id: "db",
        name: "db",
        kind: "service",
        workers: 100,
        queueLimit: null,
        workerModel: "blocking",
        serviceTime: { type: "constant", ms: 2000 },
        errorRate: 0,
        calls: [],
      });
      s.edges.push({
        id: "s-db",
        from: "server",
        to: "db",
        latency: { type: "constant", ms: 1 },
        packetLoss: 0,
        policies: {},
      });
      for (const n of s.nodes) if (n.id === "server") n.calls = [{ edgeId: "s-db" }];
      return simulate(s);
    };
    const dropped = withDb("drop-queued");
    const cancelled = withDb("cancel");
    expect(dropped.summary.orphanedWork).toBeGreaterThan(0);
    expect(sum(dropped.series.nodes.db?.success)).toBeGreaterThan(0);
    expect(sum(cancelled.series.nodes.db?.success)).toBe(0);
  });

  it("a discarded request keeps its queue slot until a worker reaches it", () => {
    // queueLimit 5: the queue fills with requests whose callers already left, so later arrivals
    // are rejected with 503 although nobody waits for the queued ones.
    const bounded = simulate(
      chain({
        ...base,
        server: { ...base.server, queueLimit: 5 },
        options: { abandonedWork: "drop-queued" },
      }),
    );
    expect(bounded.summary.rejected503).toBeGreaterThan(0);
    expect(bounded.summary.discardedWork).toBeGreaterThan(0);
  });
});

describe('options.abandonedWork: "cancel"', () => {
  it("is the same as cancelOnTimeout: true", () => {
    const a = simulate(chain({ ...base, options: { abandonedWork: "cancel" } }));
    const b = simulate(chain({ ...base, options: { cancelOnTimeout: true } }));
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("rejects a contradiction with cancelOnTimeout", () => {
    expect(() =>
      simulate(chain({ ...base, options: { cancelOnTimeout: true, abandonedWork: "continue" } })),
    ).toThrow(/abandonedWork/);
  });
});
