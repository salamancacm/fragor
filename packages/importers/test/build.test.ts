import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Scenario, simulate } from "@fragor/engine";
import { describe, expect, it } from "vitest";
import { buildScenario, type ObservedSystem, type Sourced } from "../src";
import { quarkusDemo } from "./fixtures/quarkus-demo";

const MIRROR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "examples",
  "quarkus-demo",
  "fragor",
  "baseline-read-timeout.json",
);
const mirror = JSON.parse(readFileSync(MIRROR, "utf8")) as Scenario;

function built(o: ObservedSystem = quarkusDemo, answers?: Parameters<typeof buildScenario>[1]) {
  const r = buildScenario(o, answers);
  if (!r.ok) throw new Error(`build failed: ${r.errors.join("; ")}`);
  return r;
}

const user = <T>(value: T): Sourced<T> => ({ value, origin: "user", detail: "test" });

/** A system that says almost nothing: one service, one call to an external API, some traffic. */
const bare: ObservedSystem = {
  version: 1,
  name: "bare",
  source: "test",
  window: { description: "none", durationMs: 1000 },
  services: [
    { id: "api", name: "API", kind: "service" },
    { id: "ext", name: "Provider", kind: "external-api" },
  ],
  calls: [{ id: "api-ext", from: "api", to: "ext" }],
  traffic: [{ id: "web", target: "api", rps: user(20) }],
};

describe("buildScenario from the Quarkus demo configuration", () => {
  const { scenario } = built();

  it("reproduces the hand-written mirror: nodes, edges and traffic", () => {
    expect(
      scenario.nodes.map((n) => [n.id, n.kind, n.workers, n.queueLimit, n.workerModel]),
    ).toEqual(mirror.nodes.map((n) => [n.id, n.kind, n.workers, n.queueLimit, n.workerModel]));
    expect(scenario.nodes.map((n) => n.calls)).toEqual(mirror.nodes.map((n) => n.calls));
    expect(scenario.edges).toEqual(mirror.edges);
    expect(scenario.traffic).toEqual(mirror.traffic);
  });

  it("uses the observed response times (a constant becomes a lognormal with p50 = p99)", () => {
    const times = Object.fromEntries(scenario.nodes.map((n) => [n.id, n.serviceTime]));
    expect(times.order).toEqual({ type: "lognormal", p50Ms: 10, p99Ms: 40 });
    expect(times["external-payment"]).toEqual({ type: "lognormal", p50Ms: 120, p99Ms: 400 });
    expect(times.gateway).toEqual({ type: "lognormal", p50Ms: 2, p99Ms: 2 });
  });

  it("simulates exactly like the mirror (same seed, same summary, number for number)", () => {
    // A lognormal whose p50 equals its p99 is a constant and draws the same random numbers, so
    // the draft and the hand-written mirror (without its fault) must agree exactly.
    const calm = { ...mirror, faults: [] } as Scenario;
    delete calm.options;
    const draft = built(quarkusDemo, {
      answers: [
        { op: "set", path: "seed", value: mirror.seed },
        { op: "set", path: "durationMs", value: mirror.durationMs },
      ],
    }).scenario;
    expect(simulate(draft).summary).toEqual(simulate(calm).summary);
  });

  it("is a valid scenario with no faults: you add the failure you want to try", () => {
    expect(scenario.faults).toEqual([]);
    expect(scenario.description).toContain("examples/quarkus-demo configuration");
  });
});

describe("the report", () => {
  it("says where every parameter came from and counts them", () => {
    const { report } = built();
    const byPath = Object.fromEntries(report.entries.map((e) => [e.path, e]));
    expect(byPath["nodes.order.workers"]).toMatchObject({ value: 100, origin: "config" });
    expect(byPath["nodes.order.workers"]?.detail).toContain("quarkus.thread-pool.max-threads=100");
    expect(byPath["edges.order-payment.policies.retry"]?.value).toEqual({
      maxRetries: 3,
      delayMs: 100,
      jitterMs: 50,
    });
    expect(byPath["edges.gateway-order.policies.retry"]).toMatchObject({
      value: null,
      origin: "config",
    });
    expect(byPath["traffic.web.pattern"]).toMatchObject({
      value: { type: "constant", rps: 100 },
      origin: "config",
    });
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.entries.length);
  });

  it("marks as assumed only what the demo did not say, and asks nothing", () => {
    const { report } = built();
    const assumed = report.entries.filter((e) => e.origin === "assumed").map((e) => e.path);
    expect(assumed).toEqual([
      "nodes.gateway.calls.0.probability",
      "nodes.order.calls.0.probability",
      "nodes.payment.calls.0.probability",
      "edges.gateway-order.packetLoss",
      "edges.order-payment.packetLoss",
      "edges.payment-external.packetLoss",
      "durationMs",
    ]);
    expect(report.questions).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("uses placeholders for what is missing and turns them into questions", () => {
    const { scenario, report } = built(bare);
    const api = scenario.nodes.find((n) => n.id === "api");
    const ext = scenario.nodes.find((n) => n.id === "ext");
    expect(api).toMatchObject({ workers: 50, queueLimit: 100, workerModel: "blocking" });
    expect(api?.serviceTime).toEqual({ type: "constant", ms: 10 });
    expect(ext).toMatchObject({ workers: 1000, queueLimit: null });
    const asked = report.questions.map((q) => q.path);
    expect(asked).toEqual([
      "nodes.api.workers",
      "nodes.api.queueLimit",
      "nodes.api.workerModel",
      "nodes.api.serviceTime",
      "nodes.ext.serviceTime",
      "edges.api-ext.policies.timeout",
      "edges.api-ext.policies.retry",
      "edges.api-ext.policies.circuitBreaker",
      "edges.api-ext.policies.fallback",
    ]);
    expect(report.questions[0]?.hint).toContain("quarkus.thread-pool.max-threads");
    expect(report.counts.observed + report.counts.config + report.counts.inferred).toBe(0);
    expect(report.counts.user).toBe(1);
  });

  it("asks for the thresholds of a circuit breaker it only knows exists", () => {
    const o: ObservedSystem = {
      ...bare,
      calls: [
        {
          id: "api-ext",
          from: "api",
          to: "ext",
          breaker: { value: true, origin: "observed", detail: "ft metrics" },
        },
      ],
    };
    const { scenario, report } = built(o);
    expect(scenario.edges[0]?.policies.circuitBreaker).toBeDefined();
    const entry = report.entries.find((e) => e.path === "edges.api-ext.policies.circuitBreaker");
    expect(entry).toMatchObject({ origin: "observed" });
    expect(entry?.detail).toContain("SmallRye defaults");
    const q = report.questions.find((x) => x.path === "edges.api-ext.policies.circuitBreaker");
    expect(q?.ask).toContain("thresholds");
  });

  it("warns about a service nothing reaches", () => {
    const o: ObservedSystem = {
      ...bare,
      services: [...bare.services, { id: "lonely", name: "Lonely", kind: "service" }],
    };
    expect(built(o).report.warnings).toEqual([
      'Service "lonely" receives no traffic and no call reaches it: it will stay idle.',
    ]);
  });
});

describe("answers", () => {
  it("make what they touch origin user, with the new value, and close its question", () => {
    const { scenario, report } = built(bare, {
      answers: [
        { op: "set", path: "nodes.api.workers", value: 8 },
        { op: "set", path: "edges.api-ext.policies.timeout.valueMs", value: 800 },
        {
          op: "set",
          path: "nodes.api.serviceTime",
          value: { type: "lognormal", p50Ms: 12, p99Ms: 90 },
        },
      ],
    });
    expect(scenario.nodes[0]?.workers).toBe(8);
    expect(scenario.edges[0]?.policies.timeout).toEqual({ valueMs: 800 });
    const by = Object.fromEntries(report.entries.map((e) => [e.path, e]));
    expect(by["nodes.api.workers"]).toMatchObject({ value: 8, origin: "user" });
    expect(by["edges.api-ext.policies.timeout"]).toMatchObject({
      value: { valueMs: 800 },
      origin: "user",
    });
    expect(by["nodes.api.queueLimit"]?.origin).toBe("assumed");
    const open = report.questions.map((q) => q.path);
    expect(open).not.toContain("nodes.api.workers");
    expect(open).not.toContain("nodes.api.serviceTime");
    expect(open).not.toContain("edges.api-ext.policies.timeout");
    expect(open).toContain("nodes.api.queueLimit");
  });

  it("add an entry for a parameter the draft did not have", () => {
    const { report } = built(bare, {
      answers: [{ op: "set", path: "edges.api-ext.policies.bulkhead", value: { value: 5 } }],
    });
    expect(report.entries.at(-1)).toEqual({
      path: "edges.api-ext.policies.bulkhead",
      value: { value: 5 },
      origin: "user",
      detail: "given by the user",
    });
  });

  it("can remove a policy with unset", () => {
    const { scenario, report } = built(quarkusDemo, {
      answers: [{ op: "unset", path: "edges.order-payment.policies.retry" }],
    });
    expect(scenario.edges[1]?.policies.retry).toBeUndefined();
    const e = report.entries.find((x) => x.path === "edges.order-payment.policies.retry");
    expect(e).toMatchObject({ value: null, origin: "user" });
  });

  it("refuse edits that change the structure, and edits that break the scenario", () => {
    const structural = buildScenario(bare, { answers: [{ op: "remove-node", nodeId: "ext" }] });
    expect(structural).toEqual({
      ok: false,
      errors: ['answers may only set or unset values, not "remove-node"'],
    });
    const broken = buildScenario(bare, {
      answers: [{ op: "set", path: "nodes.api.workers", value: 0 }],
    });
    expect(broken.ok).toBe(false);
    const missing = buildScenario(bare, {
      answers: [{ op: "unset", path: "nodes.ghost.workers" }],
    });
    expect(missing.ok).toBe(false);
  });
});

describe("invalid and repeatable", () => {
  it("rejects an observed system that points at services it does not list", () => {
    const o: ObservedSystem = {
      ...bare,
      calls: [{ id: "api-x", from: "api", to: "x" }],
      traffic: [{ id: "web", target: "nobody", rps: user(1) }],
    };
    const r = buildScenario(o);
    expect(r).toEqual({
      ok: false,
      errors: [
        'calls[api-x].to: unknown service "x"',
        'traffic[web].target: unknown service "nobody"',
      ],
    });
  });

  it("rejects calls that form a cycle (the scenario schema says so)", () => {
    const o: ObservedSystem = {
      ...bare,
      calls: [
        { id: "a-b", from: "api", to: "ext" },
        { id: "b-a", from: "ext", to: "api" },
      ],
    };
    const r = buildScenario(o);
    expect(r.ok).toBe(false);
  });

  it("is deterministic: the same input gives the same scenario and report", () => {
    const one = built();
    const two = built(JSON.parse(JSON.stringify(quarkusDemo)));
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });
});
