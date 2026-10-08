import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Scenario, simulate } from "@fragor/engine";
import { describe, expect, it } from "vitest";
import { parseScenario, ScenarioValidationError, safeParseScenario } from "../src";
import { EXAMPLE_FILES, rawExample } from "./examples";

function base(): Scenario {
  return parseScenario(rawExample("01-payment-slow-baseline.json"));
}

function issuesOf(input: unknown): string[] {
  const r = safeParseScenario(input);
  if (r.ok) throw new Error("expected issues");
  return r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe("parseScenario", () => {
  it("accepts every canonical example, and the engine runs what it accepts", () => {
    for (const file of EXAMPLE_FILES) {
      const s = parseScenario(rawExample(file));
      expect(simulate(s).summary.roots).toBeGreaterThan(0);
    }
  });

  it("names collection items by id in error paths", () => {
    const s = base();
    (s.edges[1] as Scenario["edges"][0]).policies.timeout = { valueMs: -5 };
    expect(issuesOf(s)).toEqual([
      "edges[order-payment].policies.timeout.valueMs: Too small: expected number to be >0",
    ]);
  });

  it("rejects unknown keys (typos) instead of ignoring them", () => {
    const s = base() as unknown as { nodes: Record<string, unknown>[] };
    (s.nodes[0] as Record<string, unknown>).wokers = 10;
    expect(issuesOf(s)[0]).toMatch(/^nodes\[gateway\]: Unrecognized key: "wokers"/);
  });

  it("reports wrong types and bad enum values", () => {
    const s = base() as unknown as { nodes: Record<string, unknown>[] };
    (s.nodes[1] as Record<string, unknown>).workerModel = "threads";
    (s.nodes[2] as Record<string, unknown>).workers = "50";
    const issues = issuesOf(s);
    expect(issues.some((i) => i.startsWith("nodes[order].workerModel:"))).toBe(true);
    expect(issues.some((i) => i.startsWith("nodes[payment].workers:"))).toBe(true);
  });

  it("checks cross references", () => {
    const s = base();
    (s.nodes[0] as Scenario["nodes"][0]).calls.push({ edgeId: "nope" });
    (s.edges[0] as Scenario["edges"][0]).to = "ghost";
    s.traffic.push({ id: "web", target: "gateway", pattern: { type: "poisson", rps: 1 } });
    s.faults.push({
      id: "f2",
      startMs: 0,
      durationMs: 1,
      target: { edge: "gateway-order" },
      effect: { type: "capacity", workersFactor: 0.5 },
    });
    expect(issuesOf(s)).toEqual([
      'traffic[web].id: duplicate id "web"',
      'nodes[gateway].calls[1].edgeId: unknown edge "nope"',
      'edges[gateway-order].to: unknown node "ghost"',
      'faults[f2].effect.type: "capacity" is not allowed for target kind "edge"; allowed: latency-add, latency-multiply, packet-loss, outage',
    ]);
  });

  it("checks abandonedWork against cancelOnTimeout", () => {
    const s = base();
    s.options = { ...s.options, abandonedWork: "drop-queued" };
    expect(safeParseScenario(s).ok).toBe(true);
    s.options = { ...s.options, cancelOnTimeout: true };
    expect(issuesOf(s)).toEqual([
      'options.abandonedWork: "drop-queued" contradicts cancelOnTimeout: true',
    ]);
  });

  it("checks relations between numbers", () => {
    const s = base();
    (s.nodes[1] as Scenario["nodes"][0]).serviceTime = { type: "lognormal", p50Ms: 50, p99Ms: 10 };
    (s.edges[2] as Scenario["edges"][0]).latency = { type: "uniform", minMs: 9, maxMs: 1 };
    expect(issuesOf(s)).toEqual([
      "nodes[order].serviceTime.p99Ms: must be >= p50Ms (50)",
      "edges[payment-external].latency.maxMs: must be >= minMs (9)",
    ]);
  });

  it("detects call cycles", () => {
    const s = base();
    s.edges.push({
      id: "back",
      from: "payment",
      to: "order",
      latency: { type: "constant", ms: 1 },
      packetLoss: 0,
      policies: {},
    });
    (s.nodes[2] as Scenario["nodes"][0]).calls.push({ edgeId: "back" });
    expect(issuesOf(s)).toEqual(["nodes: call cycle: order -> payment -> order"]);
  });

  it("parseScenario throws an error listing every issue", () => {
    expect(() => parseScenario({ schemaVersion: 2 })).toThrow(ScenarioValidationError);
    const r = safeParseScenario({ schemaVersion: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.path)).toEqual(
        expect.arrayContaining([
          "name",
          "seed",
          "durationMs",
          "nodes",
          "edges",
          "traffic",
          "faults",
        ]),
      );
    }
  });
});

describe("Quarkus demo mirror scenarios", () => {
  const dir = join(import.meta.dirname, "..", "..", "..", "examples", "quarkus-demo", "fragor");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`${file} is a valid scenario the engine runs`, () => {
      const s = parseScenario(JSON.parse(readFileSync(join(dir, file), "utf8")));
      expect(simulate(s).summary.roots).toBeGreaterThan(0);
    });
  }
});
