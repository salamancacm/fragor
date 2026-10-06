import { type Scenario, type SimulationResult, simulate } from "@fragor/engine";
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  buildAnalysisDigest,
  deriveFindings,
  type Finding,
  parseScenario,
  requiredNodes,
} from "../src";
import { EXAMPLE_FILES, rawExample } from "./examples";

function run(file: string): { scenario: Scenario; result: SimulationResult; findings: Finding[] } {
  const scenario = parseScenario(rawExample(file));
  const result = simulate(scenario);
  return { scenario, result, findings: deriveFindings(scenario, result) };
}

const ids = (fs: Finding[]) => fs.map((f) => f.id);

describe("deriveFindings", () => {
  const baseline = run("01-payment-slow-baseline.json");
  const breaker = run("02-payment-slow-with-breaker.json");

  it("is deterministic and ordered by severity", () => {
    const again = deriveFindings(baseline.scenario, simulate(baseline.scenario));
    expect(again).toEqual(baseline.findings);
    const rank = { critical: 0, warning: 1, info: 2 };
    const order = baseline.findings.map((f) => rank[f.severity]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("01: cascade from payment up to the gateway, saturation and retry amplification", () => {
    const cascade = baseline.findings.find((f) => f.id === "cascade-propagation:payment");
    expect(cascade?.severity).toBe("critical");
    expect(cascade?.evidence.map((e) => ("nodeId" in e ? e.nodeId : null))).toEqual([
      "payment",
      "order",
      "gateway",
    ]);
    expect(ids(baseline.findings)).toEqual(
      expect.arrayContaining([
        "worker-saturation:payment",
        "retry-amplification:order-payment",
        "orphaned-work:payment",
      ]),
    );
  });

  it("02: with the breaker, the cascade no longer reaches the entry point", () => {
    expect(breaker.findings.find((f) => f.rule === "cascade-propagation")?.severity).toBe(
      "warning",
    );
    const retry = breaker.findings.find((f) => f.id === "retry-amplification:order-payment");
    expect(retry?.severity).toBe("info");
    expect(retry?.summary).toMatch(/rejected by the circuit breaker/);
  });

  it("evidence points at existing ids and valid time windows", () => {
    for (const file of EXAMPLE_FILES) {
      const { scenario, result, findings } = run(file);
      const end = result.series.buckets * result.series.bucketMs;
      const traceIds = new Set(result.traces.map((t) => t.traceId));
      for (const f of findings) {
        expect(f.id.startsWith(`${f.rule}:`)).toBe(true);
        expect(f.evidence.length).toBeGreaterThan(0);
        for (const e of f.evidence) {
          if ("nodeId" in e) expect(scenario.nodes.some((n) => n.id === e.nodeId)).toBe(true);
          if ("edgeId" in e) expect(scenario.edges.some((x) => x.id === e.edgeId)).toBe(true);
          if ("traceId" in e) expect(traceIds.has(e.traceId)).toBe(true);
          expect(e.fromMs).toBeGreaterThanOrEqual(0);
          expect(e.toMs).toBeGreaterThanOrEqual(e.fromMs);
          expect(e.toMs).toBeLessThanOrEqual(end);
        }
      }
    }
  });

  it("missing-timeout flags edges that rely on the default read timeout", () => {
    const s = applyPatch(baseline.scenario, [
      { op: "unset", path: "edges.payment-external.policies.timeout" },
    ]);
    const f = deriveFindings(s, simulate(s)).find(
      (x) => x.id === "missing-timeout:payment-external",
    );
    expect(f).toBeDefined();
    expect(f?.summary).toMatch(/30000 ms/);
  });

  it("single-point-of-failure follows required calls and stops at fallbacks", () => {
    const [web] = baseline.scenario.traffic;
    if (web === undefined) throw new Error("no traffic");
    expect([...requiredNodes(baseline.scenario, web)]).toEqual([
      "gateway",
      "order",
      "payment",
      "external-payment",
    ]);
    const spof = (fs: Finding[]) =>
      fs.filter((f) => f.rule === "single-point-of-failure").map((f) => f.id);
    expect(spof(baseline.findings)).toHaveLength(3);
    // 02 has a fallback on order -> payment: payment and the external API are no longer required.
    expect(spof(breaker.findings)).toEqual(["single-point-of-failure:order"]);
  });

  it("03 vs 04: the bulkhead removes the gateway saturation finding", () => {
    expect(ids(run("03-cascade-blast-radius.json").findings)).toContain(
      "worker-saturation:gateway",
    );
    expect(ids(run("04-cascade-with-bulkhead.json").findings)).not.toContain(
      "worker-saturation:gateway",
    );
  });
});

describe("buildAnalysisDigest", () => {
  it("is deterministic, JSON-safe and compact for every example", () => {
    for (const file of EXAMPLE_FILES) {
      const { scenario, result, findings } = run(file);
      const digest = buildAnalysisDigest(scenario, result, findings);
      const json = JSON.stringify(digest);
      expect(JSON.stringify(buildAnalysisDigest(scenario, simulate(scenario), findings))).toBe(
        json,
      );
      expect(JSON.parse(json)).toEqual(digest);
      // A few thousand tokens at most (~4 characters per token).
      expect(json.length).toBeLessThan(12_000);
      expect(digest.result.fingerprint).toBe(result.fingerprint);
      expect(digest.nodes).toHaveLength(scenario.nodes.length);
      expect(digest.edges).toHaveLength(scenario.edges.length);
      expect(digest.disclaimer).toMatch(/not a prediction/);
    }
  });

  it("puts fault and breaker events on one timeline", () => {
    const { scenario, result, findings } = run("02-payment-slow-with-breaker.json");
    const d = buildAnalysisDigest(scenario, result, findings);
    expect(d.timeline[0]).toEqual({ tMs: 10000, event: "fault-start", ref: "external-slow" });
    expect(d.timeline.some((e) => e.event === "breaker-open" && e.ref === "order-payment")).toBe(
      true,
    );
    const times = d.timeline.map((e) => e.tMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
