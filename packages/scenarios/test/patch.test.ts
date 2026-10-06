import type { Scenario } from "@fragor/engine";
import { simulate } from "@fragor/engine";
import { describe, expect, it } from "vitest";
import { applyPatch, PatchError, parsePatch, parseScenario, ScenarioValidationError } from "../src";
import { rawExample } from "./examples";

const base = (): Scenario => parseScenario(rawExample("01-payment-slow-baseline.json"));

describe("applyPatch", () => {
  it("sets a value addressed by ids and never mutates the input", () => {
    const s = base();
    const before = JSON.stringify(s);
    const next = applyPatch(s, [
      { op: "set", path: "edges.order-payment.policies.timeout.valueMs", value: 1500 },
    ]);
    expect(JSON.stringify(s)).toBe(before);
    expect(next.edges.find((e) => e.id === "order-payment")?.policies.timeout?.valueMs).toBe(1500);
  });

  it("accepts array paths and creates missing objects (e.g. a new policy)", () => {
    const next = applyPatch(base(), [
      {
        op: "set",
        path: ["edges", "order-payment", "policies", "circuitBreaker"],
        value: {
          requestVolumeThreshold: 20,
          failureRatio: 0.5,
          delayMs: 10000,
          successThreshold: 2,
        },
      },
      { op: "set", path: "edges.order-payment.policies.fallback.countsAs", value: "degraded" },
    ]);
    const edge = next.edges.find((e) => e.id === "order-payment");
    expect(edge?.policies.circuitBreaker?.requestVolumeThreshold).toBe(20);
    expect(edge?.policies.fallback).toEqual({ countsAs: "degraded" });
  });

  it("unset removes a policy (breaker off)", () => {
    const withBreaker = parseScenario(rawExample("02-payment-slow-with-breaker.json"));
    const next = applyPatch(withBreaker, [
      { op: "unset", path: "edges.order-payment.policies.circuitBreaker" },
    ]);
    expect(
      next.edges.find((e) => e.id === "order-payment")?.policies.circuitBreaker,
    ).toBeUndefined();
  });

  it("indexes arrays without ids by position", () => {
    const next = applyPatch(base(), [
      { op: "set", path: "nodes.gateway.calls.0.probability", value: 0.5 },
    ]);
    expect(next.nodes[0]?.calls[0]?.probability).toBe(0.5);
  });

  it("adds a node and an edge with its call, and the engine runs the result", () => {
    const next = applyPatch(base(), [
      {
        op: "add-node",
        node: {
          id: "audit",
          name: "Audit",
          kind: "service",
          workers: 10,
          queueLimit: null,
          workerModel: "async",
          serviceTime: { type: "constant", ms: 3 },
          errorRate: 0,
          calls: [],
        },
      },
      {
        op: "add-edge",
        edge: {
          id: "order-audit",
          from: "order",
          to: "audit",
          latency: { type: "constant", ms: 1 },
          packetLoss: 0,
          policies: {},
        },
        call: { required: false },
      },
    ]);
    expect(next.nodes.find((n) => n.id === "order")?.calls.at(-1)).toEqual({
      edgeId: "order-audit",
      required: false,
    });
    expect(simulate(next).series.nodes.audit?.arrivals.some((n) => n > 0)).toBe(true);
  });

  it("remove-node drops its edges, the calls to them and the faults on them", () => {
    const next = applyPatch(base(), [{ op: "remove-node", nodeId: "external-payment" }]);
    expect(next.nodes.map((n) => n.id)).not.toContain("external-payment");
    expect(next.edges.map((e) => e.id)).not.toContain("payment-external");
    expect(next.nodes.find((n) => n.id === "payment")?.calls).toEqual([]);
    expect(next.faults).toEqual([]);
  });

  it("remove-node refuses to drop a node that receives traffic", () => {
    expect(() => applyPatch(base(), [{ op: "remove-node", nodeId: "gateway" }])).toThrow(
      /patch op #0: node "gateway" receives traffic \(web\)/,
    );
  });

  it("remove-edge drops the calls that used it", () => {
    const next = applyPatch(base(), [{ op: "remove-edge", edgeId: "order-payment" }]);
    expect(next.nodes.find((n) => n.id === "order")?.calls).toEqual([]);
  });

  it("reports unknown ids with the op index", () => {
    expect(() =>
      applyPatch(base(), [{ op: "set", path: "edges.nope.packetLoss", value: 0.1 }]),
    ).toThrow(PatchError);
    expect(() => applyPatch(base(), [{ op: "remove-edge", edgeId: "nope" }])).toThrow(
      /patch op #0/,
    );
  });

  it("validates the result and reports readable issues", () => {
    try {
      applyPatch(base(), [{ op: "set", path: "edges.order-payment.packetLoss", value: 2 }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ScenarioValidationError);
      expect((e as ScenarioValidationError).issues[0]?.path).toBe(
        "edges[order-payment].packetLoss",
      );
    }
  });
});

describe("parsePatch", () => {
  it("validates untrusted patch documents", () => {
    expect(parsePatch([{ op: "unset", path: "edges.x.policies.retry" }])).toHaveLength(1);
    expect(() => parsePatch([{ op: "explode" }])).toThrow();
    expect(() => parsePatch([{ op: "remove-node" }])).toThrow();
  });
});
