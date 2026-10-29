import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simulate } from "@fragor/engine";
import { parseObserved } from "@fragor/importers";
import { parseScenario } from "@fragor/scenarios";
import { describe, expect, it } from "vitest";
import type { Io } from "../src/io";
import { main } from "../src/main";

const FIXTURES = join(import.meta.dirname, "..", "..", "importers", "test", "fixtures");
const CALM = join(FIXTURES, "demo-calm.jsonl");
const TROUBLE = join(FIXTURES, "demo-trouble.jsonl");
const FROM = "2026-10-29T19:08:38.000Z";
const TO = "2026-10-29T19:08:41.000Z";

/** Runs the CLI with a few in-memory files on top of the real file system; writes are captured. */
function cli(argv: string[], memory: Record<string, string> = {}) {
  let out = "";
  let err = "";
  const files = new Map<string, string>(Object.entries(memory));
  const io: Io = {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    readFile: (p) => files.get(p) ?? readFileSync(p, "utf8"),
    writeFile: (p, t) => {
      files.set(p, t);
    },
  };
  const code = main(argv, io);
  return { code, out, err, files };
}

const calm = (...more: string[]) =>
  cli(["import", "traces", CALM, "--from", FROM, "--to", TO, ...more]);

describe("fragor import traces", () => {
  it("prints the report: what was measured, what is a placeholder, what to answer", () => {
    const r = calm();
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toContain("# Import report: imported-traces");
    expect(r.out).toContain("## Open questions");
    expect(r.out).toContain("| `traffic.gateway-in.pattern` |");
    expect(r.out).toContain("Add --out draft.json to write the scenario.");
  });

  it("--out writes a valid scenario of the four services that the engine runs", () => {
    const r = calm("--out", "draft.json");
    const scenario = parseScenario(JSON.parse(r.files.get("draft.json") ?? "null"));
    expect(scenario.nodes.map((n) => n.id)).toEqual([
      "gateway",
      "order",
      "payment",
      "external-payment",
    ]);
    expect(scenario.traffic[0]?.pattern).toMatchObject({ type: "poisson" });
    expect(simulate(scenario).summary.failed).toBe(0);
    expect(r.out).toContain("Scenario written to draft.json: run it with `fragor run draft.json`.");
  });

  it("--set answers a question: the value is used and the report says it came from the user", () => {
    const r = calm(
      "--out",
      "d.json",
      "--set",
      "nodes.order.workers=100",
      "--set",
      "nodes.order.queueLimit=200",
    );
    const scenario = parseScenario(JSON.parse(r.files.get("d.json") ?? "null"));
    const order = scenario.nodes.find((n) => n.id === "order");
    expect([order?.workers, order?.queueLimit]).toEqual([100, 200]);
    expect(r.out).toContain("| `nodes.order.workers` | 100 | user |");
    expect(r.out).not.toContain("- `nodes.order.workers`");
  });

  it("--report writes the report to a file and --observed saves the system it was built from", () => {
    const r = calm("--report", "report.md", "--observed", "observed.json");
    expect(r.files.get("report.md")).toContain("# Import report");
    expect(r.out).toContain("Report written to report.md.");
    expect(r.out).not.toContain("# Import report");
    const observed = parseObserved(JSON.parse(r.files.get("observed.json") ?? "null"));
    expect(observed.ok).toBe(true);
  });

  it("without --from and --to it measures the rate over the requests it has, and warns about rejections", () => {
    const r = cli(["import", "traces", TROUBLE]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("order rejected 8 requests with 503");
    expect(r.out).toContain("| `edges.order-payment.policies.retry` |");
  });

  it("--name names the system", () => {
    expect(calm("--name", "checkout").out).toContain("# Import report: checkout");
  });
});

describe("fragor import observed", () => {
  it("builds the same scenario from the observed system saved by import traces", () => {
    const first = calm("--observed", "obs.json", "--out", "a.json");
    const again = cli(["import", "observed", "obs.json", "--out", "b.json"], {
      "obs.json": first.files.get("obs.json") ?? "",
    });
    expect(again.code).toBe(0);
    expect(again.files.get("b.json")).toBe(first.files.get("a.json"));
  });

  it("names the field of a mistake in a hand-written file", () => {
    const bad = JSON.stringify({
      version: 1,
      name: "x",
      source: "s",
      window: { description: "d", durationMs: 1 },
      services: [],
      calls: [],
      traffic: [],
    });
    const r = cli(["import", "observed", "bad.json"], { "bad.json": bad });
    expect(r.code).toBe(2);
    expect(r.err).toContain("services:");
  });
});

describe("fragor import: mistakes", () => {
  it("asks for a kind and exactly one file", () => {
    expect(cli(["import"]).code).toBe(2);
    expect(cli(["import", "traces"]).code).toBe(2);
    expect(cli(["import", "logs", CALM]).code).toBe(2);
    expect(cli(["import", "traces", CALM, CALM]).code).toBe(2);
  });

  it("says when the file is missing, has no traces or the dates are wrong", () => {
    expect(cli(["import", "traces", "nope.jsonl"]).err).toContain('cannot read "nope.jsonl"');
    const empty = cli(["import", "traces", "e.jsonl"], { "e.jsonl": "not json\n" });
    expect(empty.code).toBe(2);
    expect(empty.err).toContain("no spans found");
    expect(cli(["import", "traces", CALM, "--from", "yesterday-ish"]).err).toContain(
      "--from must be a date and time",
    );
    expect(cli(["import", "traces", CALM, "--from", "2030-01-01T00:00:00Z"]).err).toContain(
      "no spans in the window",
    );
  });

  it("refuses an answer that breaks the scenario", () => {
    const r = calm("--set", "nodes.order.workers=0");
    expect(r.code).toBe(2);
    expect(r.err).toContain("cannot build a scenario");
  });
});
