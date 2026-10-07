import { describe, expect, it } from "vitest";
import { type NodeSpec, type Scenario, simulate, type TimeoutPolicy } from "../src";
import { chain } from "./helpers";

/**
 * A client calls a 1 s server with a 200 ms timeout. With enforcement "caller-pool" the timeout's
 * interruption is a task for the client's own worker pool (SmallRye @Timeout in Quarkus).
 */
function scenario(
  enforcement: TimeoutPolicy["enforcement"],
  client: Partial<NodeSpec>,
  extra: Partial<Scenario> = {},
): Scenario {
  const timeout: TimeoutPolicy =
    enforcement === undefined ? { valueMs: 200 } : { valueMs: 200, enforcement };
  return {
    ...chain({
      rps: 50,
      durationMs: 5000,
      client: { serviceTime: { type: "constant", ms: 1 }, ...client },
      server: { serviceTime: { type: "constant", ms: 1000 } },
      policies: { timeout },
      options: { defaultEdgeTimeoutMs: 3000 },
    }),
    ...extra,
  };
}

const p50 = (s: Scenario) => simulate(s).summary.p50Ms ?? 0;

describe("timeout enforcement", () => {
  it('"timer" is the default and "caller-pool" behaves the same when the caller has free workers', () => {
    const plain = simulate(scenario(undefined, { workers: 1000 }));
    const explicit = simulate(scenario("timer", { workers: 1000 }));
    const pool = simulate(scenario("caller-pool", { workers: 1000 }));
    expect(explicit.fingerprint).toBe(plain.fingerprint);
    expect(pool.summary.failed).toBe(plain.summary.failed);
    expect(pool.summary.timeouts).toBe(plain.summary.timeouts);
    expect(pool.summary.timeoutsDelayed).toBe(0);
    expect(pool.summary.timeoutsLost).toBe(0);
    expect(pool.summary.p50Ms).toBeCloseTo(plain.summary.p50Ms ?? 0, 6);
  });

  it("a saturated caller runs the timeout late: it waits behind queued requests", () => {
    // 5 blocking workers, each held while waiting for the server: the pool is always full.
    const client = { workers: 5, queueLimit: null, workerModel: "blocking" as const };
    const timer = simulate(scenario("timer", client));
    const pool = simulate(scenario("caller-pool", client));
    expect(pool.summary.timeoutsDelayed).toBeGreaterThan(0);
    expect(pool.summary.timeoutsLost).toBe(0);
    // Each attempt holds its worker longer, so the queue (and end-to-end latency) grows.
    expect(p50(scenario("caller-pool", client))).toBeGreaterThan(2 * (timer.summary.p50Ms ?? 0));
  });

  it("a full caller queue rejects the timeout task: the timeout is lost", () => {
    const client = { workers: 5, queueLimit: 5, workerModel: "blocking" as const };
    const timer = simulate(scenario("timer", client));
    const pool = simulate(scenario("caller-pool", client));
    expect(pool.summary.timeoutsLost).toBeGreaterThan(0);
    // Lost timeouts let slow (1 s) responses complete: some calls succeed that the model with
    // on-time timeouts reports as failed.
    expect(timer.summary.success).toBe(0);
    expect(pool.summary.success).toBeGreaterThan(0);
  });

  it("the read-timeout backstop (defaultEdgeTimeoutMs) still ends attempts whose timeout was lost", () => {
    const client = { workers: 5, queueLimit: 5, workerModel: "blocking" as const };
    const base = scenario("caller-pool", client);
    const r = simulate({
      ...base,
      faults: [
        {
          id: "hole",
          startMs: 0,
          durationMs: 10_000,
          target: { node: "server" },
          effect: { type: "outage", mode: "blackhole" },
        },
      ],
    });
    expect(r.summary.timeoutsLost).toBeGreaterThan(0);
    expect(r.summary.unfinished).toBe(0);
    const lost = r.traces.filter((t) => t.endMs !== null && t.endMs - t.startMs >= 3000);
    expect(lost.length).toBeGreaterThan(0);
  });

  it("an async caller keeps free workers, so its timeouts fire on time", () => {
    const client = { workers: 5, queueLimit: 5, workerModel: "async" as const };
    const pool = simulate(scenario("caller-pool", client));
    expect(pool.summary.timeoutsDelayed).toBe(0);
    expect(pool.summary.timeoutsLost).toBe(0);
    expect(pool.summary.success).toBe(0);
  });

  it("queued timeout tasks never count as queued requests", () => {
    const client = { workers: 5, queueLimit: 50, workerModel: "blocking" as const };
    const r = simulate(scenario("caller-pool", client));
    const depth = r.series.nodes.client?.queueDepthMax ?? [];
    for (const d of depth) expect(d).toBeLessThanOrEqual(50);
  });
});
