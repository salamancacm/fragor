import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ResultComparison, type SimulationResult, simulate } from "@fragor/engine";
import { type AnalysisDigest, parseScenario } from "@fragor/scenarios";
import { describe, expect, it } from "vitest";
import type { Io } from "../src/io";
import { main } from "../src/main";

const EXAMPLES = join(import.meta.dirname, "..", "..", "scenarios", "examples");
const S01 = join(EXAMPLES, "01-payment-slow-baseline.json");
const S02 = join(EXAMPLES, "02-payment-slow-with-breaker.json");

function cli(...argv: string[]): {
  code: number;
  out: string;
  err: string;
  files: Map<string, string>;
} {
  let out = "";
  let err = "";
  const files = new Map<string, string>();
  const io: Io = {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, t) => {
      files.set(p, t);
    },
  };
  const code = main(argv, io);
  return { code, out, err, files };
}

describe("fragor run", () => {
  it("prints a human summary with the honesty label and findings", () => {
    const r = cli("run", S01);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/^Fragor · payment-slow-baseline \(seed 42\)/);
    expect(r.out).toContain("Simulation based on your assumptions, not a prediction.");
    expect(r.out).toContain("id: cascade-propagation:payment");
  });

  it("--json prints exactly the engine result", () => {
    const r = cli("run", S01, "--json");
    const printed = JSON.parse(r.out) as SimulationResult;
    const direct = simulate(parseScenario(JSON.parse(readFileSync(S01, "utf8"))));
    expect(printed.fingerprint).toBe(direct.fingerprint);
  });

  it("--set and --unset apply typed patches; --seed overrides the seed", () => {
    const base = JSON.parse(cli("run", S01, "--json").out) as SimulationResult;
    const patched = JSON.parse(
      cli(
        "run",
        S01,
        "--json",
        "--set",
        "edges.order-payment.policies.timeout.valueMs=6000",
        "--unset",
        "edges.order-payment.policies.retry",
      ).out,
    ) as SimulationResult;
    expect(patched.summary.retries).toBe(0);
    expect(base.summary.retries).toBeGreaterThan(0);
    const seeded = JSON.parse(cli("run", S01, "--json", "--seed", "7").out) as SimulationResult;
    expect(seeded.seed).toBe(7);
    expect(seeded.fingerprint).not.toBe(base.fingerprint);
  });

  it("--digest prints the analysis digest", () => {
    const d = JSON.parse(cli("run", S02, "--digest").out) as AnalysisDigest;
    expect(d.digestVersion).toBe(1);
    expect(d.findings.length).toBeGreaterThan(0);
  });
});

describe("fragor compare", () => {
  it("prints a before/after table", () => {
    const r = cli("compare", S01, S02);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/metric\s+before\s+after\s+delta/);
    expect(r.out).toMatch(/Failed\s+\S+%\s+0\.0%\s+-\S+ pp\s+better/);
  });

  it("--json prints the comparison computed by the engine", () => {
    const c = JSON.parse(cli("compare", S01, S02, "--json").out) as ResultComparison;
    const failed = c.metrics.find((m) => m.key === "failedRate");
    expect(failed?.verdict).toBe("better");
    expect(failed?.after).toBe(0);
  });
});

describe("fragor schema", () => {
  it("prints or writes the committed JSON Schema", () => {
    const committed = readFileSync(join(EXAMPLES, "..", "schema", "scenario.schema.json"), "utf8");
    expect(cli("schema").out).toBe(committed);
    expect(cli("schema", "--out", "x.json").files.get("x.json")).toBe(committed);
  });
});

describe("errors", () => {
  it("usage errors exit with 2 and explain the problem", () => {
    expect(cli().code).toBe(2);
    expect(cli("run").err).toMatch(/run expects exactly one scenario file/);
    expect(cli("explode").err).toMatch(/unknown command "explode"/);
    expect(cli("run", S01, "--bogus").code).toBe(2);
    expect(cli("run", S01, "--json", "--digest").err).toMatch(/either --json or --digest/);
    expect(cli("run", S01, "--seed", "x").err).toMatch(/--seed must be an integer/);
    expect(cli("run", S01, "--set", "nonsense").err).toMatch(/--set expects path=value/);
  });

  it("invalid scenarios and patches exit with 2 and readable issues", () => {
    const r = cli("run", S01, "--set", "edges.order-payment.packetLoss=2");
    expect(r.code).toBe(2);
    expect(r.err).toContain("edges[order-payment].packetLoss");
    expect(cli("run", S01, "--set", "edges.nope.packetLoss=0").err).toMatch(
      /no item with id "nope"/,
    );
    expect(cli("run", "missing.json").err).toMatch(/cannot read "missing.json"/);
  });

  it("--help prints usage and exits 0", () => {
    const r = cli("--help");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Usage:/);
  });
});
