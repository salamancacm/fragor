import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProm } from "../src";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", "metrics", name), "utf8");

describe("parseProm", () => {
  it("reads samples with labels, skipping comments and blank lines", () => {
    const r = parseProm(
      [
        "# HELP process_uptime_seconds The uptime",
        "# TYPE process_uptime_seconds gauge",
        "process_uptime_seconds 71.6",
        "",
        'http_server_requests_seconds_count{method="POST",status="200",uri="/orders"} 1608.0',
      ].join("\n"),
    );
    expect(r.problems).toEqual([]);
    expect(r.samples).toEqual([
      { name: "process_uptime_seconds", labels: {}, value: 71.6 },
      {
        name: "http_server_requests_seconds_count",
        labels: { method: "POST", status: "200", uri: "/orders" },
        value: 1608,
      },
    ]);
  });

  it("unescapes label values and accepts a trailing timestamp and special numbers", () => {
    const r = parseProm(
      [
        'a{path="C:\\\\x",quote="say \\"hi\\"",nl="a\\nb"} 1 1700000000000',
        "b NaN",
        "c +Inf",
        "d -Inf",
        "e 1.5E3",
        "f{} 2",
      ].join("\n"),
    );
    expect(r.problems).toEqual([]);
    expect(r.samples[0]?.labels).toEqual({ path: "C:\\x", quote: 'say "hi"', nl: "a\nb" });
    expect(r.samples[0]?.value).toBe(1);
    expect(Number.isNaN(r.samples[1]?.value)).toBe(true);
    expect(r.samples[2]?.value).toBe(Number.POSITIVE_INFINITY);
    expect(r.samples[3]?.value).toBe(Number.NEGATIVE_INFINITY);
    expect(r.samples[4]?.value).toBe(1500);
    expect(r.samples[5]).toEqual({ name: "f", labels: {}, value: 2 });
  });

  it("reports the lines it cannot read and keeps the rest", () => {
    const r = parseProm(
      ["good 1", "not a sample", 'bad{x="unterminated} 2', "also_good 3"].join("\n"),
    );
    expect(r.samples.map((s) => s.name)).toEqual(["good", "also_good"]);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain("line 2");
  });

  it("reads a real Quarkus snapshot", () => {
    const r = parseProm(fixture("order-calm-b.prom"));
    expect(r.problems).toEqual([]);
    const uptime = r.samples.find((s) => s.name === "process_uptime_seconds");
    expect(uptime?.value).toBeGreaterThan(0);
    const client = r.samples.filter((s) => s.name === "http_client_requests_seconds_count");
    expect(client[0]?.labels.clientName).toBe("payment");
  });
});
