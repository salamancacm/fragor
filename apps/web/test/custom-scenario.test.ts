import { simulate } from "@fragor/engine";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/lib/examples";
import { lineColumn, readScenario, scenarioJson } from "../src/lib/import";
import { checkTemplate, DEFAULT_TEMPLATE, templateScenario } from "../src/lib/template";

describe("quick form template", () => {
  it("the default form is a valid scenario that runs and shows the fault", () => {
    const r = checkTemplate(DEFAULT_TEMPLATE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = simulate(r.scenario);
    expect(result.summary.roots).toBeGreaterThan(8000);
    expect(r.scenario.faults[0]?.effect).toEqual({
      type: "latency-add",
      add: { type: "constant", ms: 3000 },
    });
  });

  it("maps the resilience switches to client policies", () => {
    const s = templateScenario({
      ...DEFAULT_TEMPLATE,
      timeoutOnCallerPool: true,
      retries: 0,
      breaker: true,
      fallback: true,
      fault: "none",
    });
    const p = s.edges[0]?.policies;
    expect(p?.timeout).toEqual({ valueMs: 1000, enforcement: "caller-pool" });
    expect(p?.retry).toBeUndefined();
    expect(p?.circuitBreaker).toBeDefined();
    expect(p?.fallback).toEqual({ countsAs: "degraded" });
    expect(s.faults).toEqual([]);
  });

  it("no timeout leaves the policy out; error and outage faults target the dependency", () => {
    const noTimeout = templateScenario({ ...DEFAULT_TEMPLATE, timeoutMs: null });
    expect(noTimeout.edges[0]?.policies.timeout).toBeUndefined();
    const errors = templateScenario({ ...DEFAULT_TEMPLATE, fault: "errors", faultAmount: 0.5 });
    expect(errors.faults[0]).toMatchObject({
      target: { node: "dependency" },
      effect: { type: "error-rate", rate: 0.5 },
    });
    const down = templateScenario({ ...DEFAULT_TEMPLATE, fault: "down" });
    expect(down.faults[0]?.effect).toEqual({ type: "outage", mode: "refuse" });
  });

  it("an external API is never the bottleneck; a service of yours keeps its workers", () => {
    expect(templateScenario(DEFAULT_TEMPLATE).nodes[1]?.workers).toBe(1000);
    const own = templateScenario({ ...DEFAULT_TEMPLATE, dependencyKind: "service" });
    expect(own.nodes[1]).toMatchObject({ kind: "service", workers: 50 });
  });

  it("reports impossible numbers with the field that is wrong", () => {
    const r = checkTemplate({ ...DEFAULT_TEMPLATE, workers: 0, serviceP99Ms: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.issues.map((i) => i.path);
    expect(paths).toContain("nodes[my-service].workers");
    expect(paths).toContain("nodes[my-service].serviceTime.p99Ms");
  });
});

describe("importing a scenario", () => {
  it("round-trips every example through its JSON", () => {
    for (const e of EXAMPLES) {
      const r = readScenario(scenarioJson(e.scenario));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.scenario).toEqual(e.scenario);
    }
  });

  it("points at the line and column of a JSON syntax error", () => {
    const r = readScenario('{\n  "schemaVersion": 1,\n  "name": "x",,\n}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^Not valid JSON/);
    expect(r.errors[0]).toMatch(/line 3/);
  });

  it("names the field when the schema rejects it", () => {
    const s = JSON.parse(scenarioJson(EXAMPLES[0]?.scenario ?? templateScenario(DEFAULT_TEMPLATE)));
    s.nodes[1].workers = -3;
    s.edges[0].to = "ghost";
    const r = readScenario(JSON.stringify(s));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith("nodes[order].workers:"))).toBe(true);
    expect(r.errors.some((e) => e.includes('unknown node "ghost"'))).toBe(true);
  });

  it("refuses empty and oversized input", () => {
    expect(readScenario("   ")).toEqual({
      ok: false,
      errors: ["Paste a scenario or choose a file."],
    });
    const big = readScenario(`"${"x".repeat(2_000_001)}"`);
    expect(big.ok).toBe(false);
  });

  it("computes 1-based line and column", () => {
    expect(lineColumn("ab\ncd", 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
  });
});
