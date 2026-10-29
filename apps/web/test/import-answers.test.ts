import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScenario, observeTraces, parseOtlp, valueAt } from "@fragor/importers";
import type { PatchOp } from "@fragor/scenarios";
import { describe, expect, it } from "vitest";
import {
  type Answer,
  answerOps,
  answerProblem,
  initialAnswer,
  kindOf,
} from "../src/lib/import-answers";

const calmText = readFileSync(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "packages",
    "importers",
    "test",
    "fixtures",
    "demo-calm.jsonl",
  ),
  "utf8",
);
const FROM = Date.parse("2026-10-29T19:08:38.000Z");
const observed = (() => {
  const r = observeTraces(parseOtlp(calmText).spans, {
    source: "t",
    fromMs: FROM,
    toMs: FROM + 3000,
  });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.observed;
})();

function build(answers: PatchOp[] = []) {
  const r = buildScenario(observed, { answers });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r;
}

describe("kindOf", () => {
  it("knows the form of each question of an import", () => {
    expect(kindOf("nodes.order.workers")).toBe("workers");
    expect(kindOf("nodes.order.queueLimit")).toBe("queueLimit");
    expect(kindOf("nodes.order.workerModel")).toBe("workerModel");
    expect(kindOf("nodes.order.serviceTime")).toBe("serviceTime");
    expect(kindOf("edges.order-payment.policies.timeout")).toBe("timeout");
    expect(kindOf("edges.order-payment.policies.retry")).toBe("retry");
    expect(kindOf("edges.order-payment.policies.circuitBreaker")).toBe("breaker");
    expect(kindOf("edges.order-payment.policies.fallback")).toBe("fallback");
    expect(kindOf("durationMs")).toBeNull();
    expect(kindOf("nodes.order.workers.extra")).toBeNull();
  });

  it("every question the demo's traces leave open has a form", () => {
    for (const q of build().report.questions) expect(kindOf(q.path), q.path).not.toBeNull();
  });
});

describe("answerProblem", () => {
  it("says what is wrong, in words", () => {
    expect(answerProblem({ kind: "workers", value: 0 })).toMatch(/at least 1/);
    expect(answerProblem({ kind: "workers", value: 2.5 })).toMatch(/whole number/);
    expect(answerProblem({ kind: "queueLimit", value: -1 })).toMatch(/whole number/);
    expect(answerProblem({ kind: "serviceTime", p50Ms: 0, p99Ms: 5 })).toMatch(/above 0/);
    expect(answerProblem({ kind: "serviceTime", p50Ms: 50, p99Ms: 10 })).toMatch(
      /p99 cannot be below/,
    );
    expect(answerProblem({ kind: "timeout", valueMs: 0 })).toMatch(/above 0/);
    expect(answerProblem({ kind: "retry", retries: 101 })).toMatch(/0 to 100/);
  });

  it("accepts the values the forms produce", () => {
    const fine: Answer[] = [
      { kind: "workers", value: 50 },
      { kind: "queueLimit", value: null },
      { kind: "queueLimit", value: 0 },
      { kind: "workerModel", value: "async" },
      { kind: "serviceTime", p50Ms: 5, p99Ms: 5 },
      { kind: "timeout", valueMs: null },
      { kind: "retry", retries: 0 },
      { kind: "breaker", on: true },
      { kind: "fallback", on: false },
    ];
    for (const a of fine) expect(answerProblem(a), a.kind).toBeNull();
  });
});

describe("answerOps", () => {
  it("sets the plain values", () => {
    expect(answerOps("nodes.a.workers", { kind: "workers", value: 8 }, 50)).toEqual([
      { op: "set", path: "nodes.a.workers", value: 8 },
    ]);
    expect(answerOps("nodes.a.queueLimit", { kind: "queueLimit", value: null }, 100)).toEqual([
      { op: "set", path: "nodes.a.queueLimit", value: null },
    ]);
    expect(
      answerOps("nodes.a.serviceTime", { kind: "serviceTime", p50Ms: 12, p99Ms: 90 }, undefined),
    ).toEqual([
      {
        op: "set",
        path: "nodes.a.serviceTime",
        value: { type: "lognormal", p50Ms: 12, p99Ms: 90 },
      },
    ]);
  });

  it("creates a policy that is not there, and edits one that is, keeping its other settings", () => {
    const p = "edges.e.policies";
    expect(answerOps(`${p}.timeout`, { kind: "timeout", valueMs: 800 }, null)).toEqual([
      { op: "set", path: `${p}.timeout`, value: { valueMs: 800 } },
    ]);
    expect(
      answerOps(
        `${p}.timeout`,
        { kind: "timeout", valueMs: 800 },
        { valueMs: 2000, enforcement: "caller-pool" },
      ),
    ).toEqual([{ op: "set", path: `${p}.timeout.valueMs`, value: 800 }]);
    expect(answerOps(`${p}.retry`, { kind: "retry", retries: 3 }, null)).toEqual([
      { op: "set", path: `${p}.retry`, value: { maxRetries: 3, delayMs: 0, jitterMs: 200 } },
    ]);
    expect(
      answerOps(
        `${p}.retry`,
        { kind: "retry", retries: 3 },
        { maxRetries: 2, delayMs: 100, jitterMs: 50 },
      ),
    ).toEqual([{ op: "set", path: `${p}.retry.maxRetries`, value: 3 }]);
  });

  it("removes a policy with unset, and creates a breaker or fallback with SmallRye's defaults", () => {
    const p = "edges.e.policies";
    expect(answerOps(`${p}.timeout`, { kind: "timeout", valueMs: null }, { valueMs: 1 })).toEqual([
      { op: "unset", path: `${p}.timeout` },
    ]);
    expect(answerOps(`${p}.retry`, { kind: "retry", retries: 0 }, null)).toEqual([
      { op: "unset", path: `${p}.retry` },
    ]);
    expect(answerOps(`${p}.circuitBreaker`, { kind: "breaker", on: false }, null)).toEqual([
      { op: "unset", path: `${p}.circuitBreaker` },
    ]);
    expect(answerOps(`${p}.circuitBreaker`, { kind: "breaker", on: true }, null)).toEqual([
      {
        op: "set",
        path: `${p}.circuitBreaker`,
        value: {
          requestVolumeThreshold: 20,
          failureRatio: 0.5,
          delayMs: 5000,
          successThreshold: 1,
        },
      },
    ]);
    expect(answerOps(`${p}.fallback`, { kind: "fallback", on: true }, null)).toEqual([
      { op: "set", path: `${p}.fallback`, value: { countsAs: "degraded" } },
    ]);
  });

  it("keeps the thresholds of a breaker that is already there when it is confirmed", () => {
    const custom = {
      requestVolumeThreshold: 10,
      failureRatio: 0.3,
      delayMs: 1000,
      successThreshold: 2,
    };
    expect(
      answerOps("edges.e.policies.circuitBreaker", { kind: "breaker", on: true }, custom),
    ).toEqual([{ op: "set", path: "edges.e.policies.circuitBreaker", value: custom }]);
  });
});

describe("initialAnswer", () => {
  it("starts each form from what the draft has now", () => {
    const { scenario } = build();
    const at = (p: string) => valueAt(scenario, p);
    expect(initialAnswer("workers", at("nodes.order.workers"))).toEqual({
      kind: "workers",
      value: 50,
    });
    expect(initialAnswer("queueLimit", at("nodes.order.queueLimit"))).toEqual({
      kind: "queueLimit",
      value: 100,
    });
    const st = initialAnswer("serviceTime", at("nodes.order.serviceTime"));
    expect(st).toMatchObject({ kind: "serviceTime" });
    expect(initialAnswer("timeout", at("edges.gateway-order.policies.timeout"))).toEqual({
      kind: "timeout",
      valueMs: null,
    });
    expect(initialAnswer("breaker", at("edges.gateway-order.policies.circuitBreaker"))).toEqual({
      kind: "breaker",
      on: false,
    });
  });

  it("reads a constant service time as p50 = p99", () => {
    expect(initialAnswer("serviceTime", { type: "constant", ms: 10 })).toEqual({
      kind: "serviceTime",
      p50Ms: 10,
      p99Ms: 10,
    });
  });
});

describe("answering every open question of the demo's traces", () => {
  // What the demo's own configuration says (examples/quarkus-demo): pools, no breaker, no fallback.
  const pools: Record<string, [number, number]> = {
    gateway: [200, 1000],
    order: [100, 200],
    payment: [50, 100],
    "external-payment": [1000, 1000],
  };
  const timeouts: Record<string, number | null> = {
    "gateway-order": 10_000,
    "order-payment": 2000,
    "payment-external-payment": 30_000,
  };

  it("closes them all, with the demo's real pools and timeouts", () => {
    const draft = build();
    const answers: PatchOp[] = [];
    for (const q of draft.report.questions) {
      const kind = kindOf(q.path);
      if (kind === null) throw new Error(q.path);
      const [, , id] = /^(nodes|edges)\.([^.]+)/.exec(q.path) ?? [];
      const current = valueAt(draft.scenario, q.path);
      const answer: Answer =
        kind === "workers"
          ? { kind, value: (pools[id as string] as [number, number])[0] }
          : kind === "queueLimit"
            ? { kind, value: (pools[id as string] as [number, number])[1] }
            : kind === "workerModel"
              ? { kind, value: "blocking" }
              : kind === "serviceTime"
                ? initialAnswer(kind, current)
                : kind === "timeout"
                  ? { kind, valueMs: timeouts[id as string] ?? null }
                  : kind === "retry"
                    ? { kind, retries: id === "order-payment" ? 3 : 0 }
                    : { kind, on: false };
      expect(answerProblem(answer), q.path).toBeNull();
      answers.push(...answerOps(q.path, answer, current));
    }
    const final = build(answers);
    expect(final.report.questions).toEqual([]);
    const by = Object.fromEntries(
      final.scenario.nodes.map((n) => [n.id, [n.workers, n.queueLimit]]),
    );
    expect(by).toEqual(pools);
    const edge = (id: string) => final.scenario.edges.find((e) => e.id === id)?.policies;
    expect(edge("gateway-order")?.timeout).toEqual({ valueMs: 10_000 });
    expect(edge("order-payment")?.timeout).toEqual({ valueMs: 2000 });
    expect(edge("order-payment")?.retry?.maxRetries).toBe(3);
    expect(edge("order-payment")?.circuitBreaker).toBeUndefined();
    expect(final.report.counts.user).toBeGreaterThan(10);
  });
});
