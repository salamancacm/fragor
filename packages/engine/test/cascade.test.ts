import { describe, expect, it } from "vitest";
import { simulate } from "../src";
import { example } from "./examples";

const blastRadius = example("03-cascade-blast-radius.json");

describe("blocking vs async workers (test group 9)", () => {
  const blocking = simulate(blastRadius);
  const asyncScenario = structuredClone(blastRadius);
  for (const n of asyncScenario.nodes) if (n.id === "gateway") n.workerModel = "async";
  const nonBlocking = simulate(asyncScenario);
  const maxUtil = (r: typeof blocking) => Math.max(...(r.series.nodes.gateway?.utilization ?? []));

  it("blocking: gateway workers wait on the slow dependency and saturate", () => {
    expect(maxUtil(blocking)).toBeGreaterThan(0.99);
    expect(blocking.summary.byTraffic.users?.failed).toBeGreaterThan(0);
  });

  it("async: the same slowness does not saturate the gateway", () => {
    expect(maxUtil(nonBlocking)).toBeLessThan(0.5);
    expect(nonBlocking.summary.byTraffic.users?.failed).toBe(0);
  });

  it("async jobs wait on dependencies without holding a worker", () => {
    const gw = nonBlocking.series.nodes.gateway;
    const orders = nonBlocking.summary.byTraffic.orders;
    expect(orders?.success).toBe(orders?.roots);
    expect(gw?.rejected503.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("blast radius and bulkhead (test group 10)", () => {
  const without = simulate(blastRadius);
  const withBulkhead = simulate(example("04-cascade-with-bulkhead.json"));

  it("scenario 03: the slow /orders path takes /users down too", () => {
    const users = without.summary.byTraffic.users;
    expect(users).toBeDefined();
    expect((users?.failed ?? 0) / (users?.roots ?? 1)).toBeGreaterThan(0.1);
  });

  it("scenario 04: the bulkhead keeps /users healthy", () => {
    expect(withBulkhead.summary.byTraffic.users?.failed).toBe(0);
    expect(withBulkhead.summary.byTraffic.users?.p99Ms).toBeLessThan(500);
  });

  it("scenario 04: /orders fails fast with bulkhead-full instead", () => {
    expect(withBulkhead.summary.failureReasons["bulkhead-full"]).toBeGreaterThan(0);
    expect(withBulkhead.summary.bulkheadFull).toBe(
      withBulkhead.summary.failureReasons["bulkhead-full"],
    );
    expect(Math.max(...(withBulkhead.series.nodes.gateway?.utilization ?? []))).toBeLessThan(0.9);
  });
});
