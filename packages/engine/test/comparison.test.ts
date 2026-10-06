import { describe, expect, it } from "vitest";
import { compareResults, simulate } from "../src";
import { chain } from "./helpers";

describe("compareResults", () => {
  const slow = chain({
    server: { serviceTime: { type: "constant", ms: 600 } },
    policies: { timeout: { valueMs: 500 } },
  });
  const before = simulate(slow);
  const after = simulate({
    ...slow,
    edges: slow.edges.map((e) => ({ ...e, policies: { timeout: { valueMs: 1000 } } })),
  });
  const c = compareResults(before, after);
  const metric = (key: string) => c.metrics.find((m) => m.key === key);

  it("identifies both runs", () => {
    expect(c.comparisonVersion).toBe(1);
    expect(c.before.fingerprint).toBe(before.fingerprint);
    expect(c.after.fingerprint).toBe(after.fingerprint);
  });

  it("computes deltas and verdicts in the right direction", () => {
    expect(metric("failedRate")).toMatchObject({
      before: 1,
      after: 0,
      delta: -1,
      verdict: "better",
    });
    expect(metric("successRate")).toMatchObject({ before: 0, after: 1, verdict: "better" });
    expect(metric("timeouts")?.verdict).toBe("better");
    expect(metric("roots")).toMatchObject({ delta: 0, verdict: "n/a" });
  });

  it("comparing a result with itself is all same / n/a", () => {
    for (const m of compareResults(before, before).metrics) {
      expect(["same", "n/a"]).toContain(m.verdict);
    }
  });

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});
