import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOtlp } from "../src";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

const doc = (spans: unknown[], service: unknown = "svc") =>
  JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes:
            service === null ? [] : [{ key: "service.name", value: { stringValue: service } }],
        },
        scopeSpans: [{ scope: { name: "t" }, spans }],
      },
    ],
  });

const raw = (extra: Record<string, unknown> = {}) => ({
  traceId: "0af7651916cd43dd8448eb211c80319c",
  spanId: "b7ad6b7169203331",
  name: "GET /x",
  kind: 2,
  startTimeUnixNano: "1793300846257822364",
  endTimeUnixNano: "1793300846449275528",
  status: {},
  ...extra,
});

describe("parseOtlp on real traces of the Quarkus demo", () => {
  const { spans, problems } = parseOtlp(fixture("demo-calm.jsonl"));

  it("reads every span of the Collector's file", () => {
    expect(problems).toEqual([]);
    expect(spans).toHaveLength(630);
    const kinds = (k: string) => spans.filter((s) => s.kind === k).length;
    expect([kinds("server"), kinds("client")]).toEqual([360, 270]);
  });

  it("keeps ids, services, times and the HTTP view of each span", () => {
    const client = spans.find((s) => s.kind === "client" && s.service === "order");
    expect(client).toBeDefined();
    expect(client?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(client?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(client?.peer).toBe("payment:8082");
    expect(client?.httpStatus).toBe(200);
    expect(client?.error).toBe(false);
    expect(client?.endMs).toBeGreaterThan(client?.startMs ?? Number.POSITIVE_INFINITY);
    // Epoch milliseconds, around 2026-10-29.
    expect(client?.startMs).toBeGreaterThan(1.79e12);
    expect(client?.startMs).toBeLessThan(1.8e12);
  });

  it("a trace's entry span has no parent, the others point at one that exists", () => {
    const ids = new Set(spans.map((s) => s.spanId));
    const roots = spans.filter((s) => s.parentSpanId === null);
    expect(roots).toHaveLength(90);
    expect(roots.every((s) => s.service === "gateway" && s.kind === "server")).toBe(true);
    expect(
      spans.filter((s) => s.parentSpanId !== null).every((s) => ids.has(s.parentSpanId as string)),
    ).toBe(true);
  });
});

describe("parseOtlp rules of OTLP/JSON", () => {
  it("converts 64-bit nanosecond strings without losing the microseconds", () => {
    const [s] = parseOtlp(doc([raw()])).spans;
    expect(s?.startMs).toBeCloseTo(1793300846257.822, 3);
    expect(s?.endMs).toBeCloseTo(1793300846449.275, 3);
  });

  it("accepts enum names, integer attributes as numbers and an error status given by name", () => {
    const span = raw({
      kind: "SPAN_KIND_CLIENT",
      status: { code: "STATUS_CODE_ERROR" },
      attributes: [
        { key: "http.response.status_code", value: { intValue: 503 } },
        { key: "server.address", value: { stringValue: "api.example.com" } },
        { key: "server.port", value: { intValue: "443" } },
      ],
    });
    const [s] = parseOtlp(doc([span])).spans;
    expect(s).toMatchObject({
      kind: "client",
      error: true,
      httpStatus: 503,
      peer: "api.example.com:443",
    });
  });

  it("a peer without a port is just the address; no address, no peer", () => {
    const withHost = raw({ attributes: [{ key: "server.address", value: { stringValue: "db" } }] });
    expect(parseOtlp(doc([withHost])).spans[0]?.peer).toBe("db");
    expect(parseOtlp(doc([raw()])).spans[0]?.peer).toBeNull();
  });

  it("names a resource without service.name like OpenTelemetry does", () => {
    expect(parseOtlp(doc([raw()], null)).spans[0]?.service).toBe("unknown_service");
  });

  it("skips spans that cannot be read, such as one that ends before it starts", () => {
    const bad = raw({ endTimeUnixNano: "1793300846000000000" });
    const noIds = { name: "x" };
    expect(parseOtlp(doc([bad, noIds, raw()])).spans).toHaveLength(1);
  });

  it("reads one pretty-printed document and an array of documents", () => {
    const pretty = JSON.stringify(JSON.parse(doc([raw()])), null, 2);
    expect(parseOtlp(pretty)).toMatchObject({
      problems: [],
      spans: [{ spanId: "b7ad6b7169203331" }],
    });
    const many = `[${doc([raw()])}, ${doc([raw({ spanId: "1111111111111111" })])}]`;
    expect(parseOtlp(many).spans).toHaveLength(2);
  });

  it("reports lines it cannot read and keeps the rest", () => {
    const text = [doc([raw()]), "not json", '{"other": 1}', ""].join("\n");
    const r = parseOtlp(text);
    expect(r.spans).toHaveLength(1);
    expect(r.problems).toEqual(["Line 2 is not valid JSON.", "Line 3 has no resourceSpans."]);
  });

  it("says so when the file is empty", () => {
    expect(parseOtlp("  \n")).toEqual({ spans: [], problems: ["The file is empty."] });
  });
});
