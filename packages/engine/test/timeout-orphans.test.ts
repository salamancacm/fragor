import { describe, expect, it } from "vitest";
import { simulate } from "../src";
import { chain } from "./helpers";

describe("constant latency above the timeout (test group 4)", () => {
  // Server takes 5 s, the client gives up after 2 s and retries 3 times without delay.
  const scenario = chain({
    rps: 10,
    server: { serviceTime: { type: "constant", ms: 5000 } },
    policies: {
      timeout: { valueMs: 2000 },
      retry: { maxRetries: 3, delayMs: 0, jitterMs: 0 },
    },
  });
  const r = simulate(scenario);

  it("never succeeds and every root fails with timeout", () => {
    expect(r.summary.roots).toBe(100);
    expect(r.summary.success).toBe(0);
    expect(r.summary.failed).toBe(100);
    expect(r.summary.failureReasons.timeout).toBe(100);
  });

  it("makes exactly 1 + maxRetries attempts per root (4x amplification)", () => {
    expect(r.summary.attempts).toBe(400);
    expect(r.summary.retries).toBe(300);
    expect(r.summary.timeouts).toBe(400);
    const serverArrivals = r.series.nodes.server?.arrivals.reduce((a, b) => a + b, 0);
    expect(serverArrivals).toBe(4 * r.summary.roots);
  });

  it("end-to-end latency includes every attempt: about 4 x 2 s", () => {
    expect(r.summary.p50Ms).toBeGreaterThanOrEqual(8000);
    expect(r.summary.p99Ms).toBeLessThan(8100);
  });
});

describe("orphaned work (test group 5)", () => {
  // 5 workers x 1 s = 5 rps of capacity, 10 rps offered, callers give up after 500 ms.
  const r = simulate(
    chain({
      rps: 10,
      server: { workers: 5, serviceTime: { type: "constant", ms: 1000 } },
      policies: { timeout: { valueMs: 500 } },
    }),
  );
  const util = r.series.nodes.server?.utilization ?? [];

  it("every caller gave up, yet the server finished all the work", () => {
    expect(r.summary.failureReasons.timeout).toBe(100);
    expect(r.summary.orphanedWork).toBe(100);
    expect(r.summary.orphanedResponses).toBe(100);
  });

  it("the server stays saturated long after the last caller gave up", () => {
    const lastRootEnd = Math.max(...r.traces.map((t) => t.endMs ?? 0));
    expect(lastRootEnd).toBeLessThan(11_000);
    // Backlog: 100 jobs at 5 per second -> busy until about t = 20 s.
    for (const u of util.slice(11, 19)) expect(u).toBeGreaterThan(0.99);
  });

  it("orphaned jobs are flagged in traces", () => {
    const orphaned = r.traces.flatMap((t) => t.spans).filter((s) => s.kind === "job" && s.orphaned);
    expect(orphaned.length).toBeGreaterThan(0);
  });
});

describe("cancelOnTimeout", () => {
  const base = {
    rps: 10,
    server: { workers: 5, serviceTime: { type: "constant", ms: 1000 } as const },
    policies: { timeout: { valueMs: 500 } },
  };

  it("drops queued work and frees the server when the caller times out", () => {
    const keep = simulate(chain(base));
    const cancel = simulate(chain({ ...base, options: { cancelOnTimeout: true } }));
    expect(cancel.summary.failureReasons.timeout).toBe(100);
    expect(cancel.summary.orphanedWork).toBe(0);
    expect(cancel.summary.orphanedResponses).toBe(0);
    // Running jobs finish their own service time (it cannot be interrupted), then nothing.
    const busy = (r: typeof keep) => (r.series.nodes.server?.utilization ?? []).slice(12, 19);
    for (const u of busy(cancel)) expect(u).toBe(0);
    expect(cancel.series.buckets).toBeLessThan(keep.series.buckets);
    expect(busy(keep)).toHaveLength(7);
    for (const u of busy(keep)) expect(u).toBeGreaterThan(0.99);
  });

  it("propagates cancellation to downstream dependencies", () => {
    const scenario = chain({ ...base, options: { cancelOnTimeout: true } });
    scenario.nodes.push({
      id: "db",
      name: "db",
      kind: "service",
      workers: 1,
      queueLimit: null,
      workerModel: "blocking",
      serviceTime: { type: "constant", ms: 2000 },
      errorRate: 0,
      calls: [],
    });
    scenario.edges.push({
      id: "s-db",
      from: "server",
      to: "db",
      latency: { type: "constant", ms: 1 },
      packetLoss: 0,
      policies: {},
    });
    const server = scenario.nodes[1];
    if (server === undefined) throw new Error("missing server");
    server.serviceTime = { type: "constant", ms: 1 };
    server.calls = [{ edgeId: "s-db" }];
    const r = simulate(scenario);
    const dbArrivals = (r.series.nodes.db?.arrivals ?? []).reduce((a, b) => a + b, 0);
    const dbDone = (r.series.nodes.db?.success ?? []).reduce((a, b) => a + b, 0);
    // Each db job takes 2 s but callers wait 500 ms: queued db work is cancelled.
    expect(dbArrivals).toBe(100);
    expect(dbDone).toBeLessThan(10);
    expect(r.traces.flatMap((t) => t.spans).some((s) => s.cancelled)).toBe(true);
  });
});
