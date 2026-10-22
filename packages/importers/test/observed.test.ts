import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildScenario,
  OBSERVED_SCHEMA_ID,
  type ObservedSystem,
  observedJsonSchema,
  parseObserved,
  renderReport,
} from "../src";
import { quarkusDemo } from "./fixtures/quarkus-demo";

const COMMITTED = join(import.meta.dirname, "..", "schema", "observed-system.schema.json");
const clone = (): ObservedSystem => JSON.parse(JSON.stringify(quarkusDemo)) as ObservedSystem;

describe("parseObserved", () => {
  it("accepts the Quarkus demo and keeps it as it is", () => {
    const r = parseObserved(JSON.parse(JSON.stringify(quarkusDemo)));
    expect(r).toEqual({ ok: true, observed: quarkusDemo });
  });

  it("names the field of every problem, by id", () => {
    const o = clone();
    const order = o.services[1];
    if (order?.workers === undefined || order.serviceTime === undefined) throw new Error("fixture");
    order.workers.value = 0;
    order.serviceTime.value = { p50Ms: 50, p99Ms: 10 };
    const r = parseObserved(o);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith("services[order].workers.value:"))).toBe(true);
    expect(r.errors).toContain("services[order].serviceTime.value.p99Ms: p99Ms must be >= p50Ms");
  });

  it("rejects unknown keys (typos) and an unknown origin", () => {
    const o = clone() as unknown as { services: Record<string, unknown>[] };
    (o.services[0] as Record<string, unknown>).wokers = 3;
    const typo = parseObserved(o);
    expect(typo.ok).toBe(false);
    if (!typo.ok)
      expect(typo.errors[0]).toMatch(/^services\[gateway\]: Unrecognized key: "wokers"/);

    const bad = clone();
    const w = bad.services[0]?.workers;
    if (w === undefined) throw new Error("fixture");
    (w as { origin: string }).origin = "guess";
    expect(parseObserved(bad).ok).toBe(false);
  });

  it("catches duplicate ids and references to services that are not listed", () => {
    const o = clone();
    o.services.push({ id: "order", name: "Again", kind: "service" });
    o.calls.push({ id: "gateway-ghost", from: "gateway", to: "ghost" });
    o.traffic.push({ id: "web", target: "nobody", rps: { value: 1, origin: "user", detail: "t" } });
    const r = parseObserved(o);
    expect(r).toEqual({
      ok: false,
      errors: [
        'services[order].id: duplicate id "order"',
        'traffic[web].id: duplicate id "web"',
        'calls[gateway-ghost].to: unknown service "ghost"',
        'traffic[web].target: unknown service "nobody"',
      ],
    });
  });

  it("requires a value to say where it came from", () => {
    const o = clone() as unknown as { services: { workers: Record<string, unknown> }[] };
    delete o.services[0]?.workers.detail;
    expect(parseObserved(o).ok).toBe(false);
  });
});

describe("observed system JSON Schema", () => {
  const schema = observedJsonSchema();

  it("matches the committed file (regenerate with UPDATE_SCHEMA=1 vitest run packages/importers)", () => {
    const text = `${JSON.stringify(schema, null, 2)}\n`;
    if (process.env.UPDATE_SCHEMA === "1") writeFileSync(COMMITTED, text);
    expect(readFileSync(COMMITTED, "utf8")).toBe(text);
  });

  it("is a draft 2020-12 schema with a stable id", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(OBSERVED_SCHEMA_ID);
  });

  it("documents every property and states units", () => {
    const undocumented: string[] = [];
    const walk = (value: unknown, pointer: string): void => {
      if (typeof value !== "object" || value === null) return;
      if (Array.isArray(value)) {
        for (const [i, v] of value.entries()) walk(v, `${pointer}/${i}`);
        return;
      }
      const obj = value as Record<string, unknown>;
      const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
      for (const [name, prop] of Object.entries(props ?? {})) {
        if (typeof prop.description !== "string" && !("$ref" in prop))
          undocumented.push(`${pointer}/properties/${name}`);
        if (/Ms$/.test(name)) expect(JSON.stringify(prop), name).toMatch(/milliseconds/);
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${pointer}/${k}`);
    };
    walk(schema, "#");
    expect(undocumented).toEqual([]);
  });

  it("accepts the demo as JSON: the file is what a person or a tool would write", () => {
    const text = JSON.stringify(quarkusDemo, null, 2);
    const r = parseObserved(JSON.parse(text));
    expect(r.ok).toBe(true);
  });
});

describe("renderReport", () => {
  it("writes the summary, the open questions and a table of parameters", () => {
    const o: ObservedSystem = {
      version: 1,
      name: "bare",
      source: "test",
      window: { description: "none", durationMs: 1000 },
      services: [{ id: "api", name: "API", kind: "service" }],
      calls: [],
      traffic: [{ id: "web", target: "api", rps: { value: 5, origin: "observed", detail: "a|b" } }],
    };
    const r = buildScenario(o);
    if (!r.ok) throw new Error(r.errors.join(";"));
    const md = renderReport(r.report);
    expect(md).toContain("# Import report: bare");
    expect(md).toMatch(/\*\*\d+ are placeholders\*\*/);
    expect(md).toContain("## Open questions");
    expect(md).toContain(
      "- `nodes.api.workers` (using 50): How many worker threads does API have? (Quarkus: quarkus.thread-pool.max-threads)",
    );
    expect(md).toContain("| `nodes.api.workers` | 50 | assumed | not observed: placeholder |");
    expect(md).toContain("a\\|b");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("says so when nothing is a placeholder", () => {
    const r = buildScenario(quarkusDemo, {
      answers: [
        { op: "set", path: "durationMs", value: 30_000 },
        { op: "set", path: "edges.gateway-order.packetLoss", value: 0 },
        { op: "set", path: "edges.order-payment.packetLoss", value: 0 },
        { op: "set", path: "edges.payment-external.packetLoss", value: 0 },
        { op: "set", path: "nodes.gateway.calls.0.probability", value: 1 },
        { op: "set", path: "nodes.order.calls.0.probability", value: 1 },
        { op: "set", path: "nodes.payment.calls.0.probability", value: 1 },
      ],
    });
    if (!r.ok) throw new Error(r.errors.join(";"));
    expect(r.report.counts.assumed).toBe(0);
    expect(renderReport(r.report)).toContain("No parameter is a placeholder.");
  });
});
