import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simulate } from "@fragor/engine";
import { describe, expect, it } from "vitest";
import {
  buildScenario,
  type ObservedSystem,
  observeTraces,
  parseOtlp,
  type Span,
  type SpanKind,
} from "../src";
import { ascending, quantile } from "../src/stats";

const read = (name: string) =>
  parseOtlp(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")).spans;

/** The calm window of the capture: requests that started in these 3 s, all of them. */
const CALM_FROM = Date.parse("2026-10-29T19:08:38.000Z");
const calm = read("demo-calm.jsonl");
const trouble = read("demo-trouble.jsonl");

function observe(
  spans: Span[],
  options: Partial<Parameters<typeof observeTraces>[1]> = {},
): ObservedSystem {
  const r = observeTraces(spans, { source: "test", ...options });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.observed;
}

const byId = <T extends { id: string }>(xs: T[], id: string): T => {
  const x = xs.find((y) => y.id === id);
  if (x === undefined) throw new Error(`missing ${id}`);
  return x;
};

describe("observeTraces on a calm window of the Quarkus demo", () => {
  const o = observe(calm, { fromMs: CALM_FROM, toMs: CALM_FROM + 3000 });

  it("finds the four services, entry first, and the three calls between them", () => {
    expect(o.services.map((s) => [s.id, s.kind])).toEqual([
      ["gateway", "service"],
      ["order", "service"],
      ["payment", "service"],
      ["external-payment", "service"],
    ]);
    expect(o.calls.map((c) => [c.id, c.from, c.to])).toEqual([
      ["gateway-order", "gateway", "order"],
      ["order-payment", "order", "payment"],
      ["payment-external-payment", "payment", "external-payment"],
    ]);
  });

  it("measures the traffic: 90 requests in 3 s", () => {
    expect(o.traffic).toHaveLength(1);
    const t = byId(o.traffic, "gateway-in");
    expect(t.target).toBe("gateway");
    expect(t.rps.value).toBeCloseTo(30, 6);
    expect(t.rps.origin).toBe("observed");
  });

  it("every request makes every call, and nothing fails by itself", () => {
    for (const c of o.calls) expect(c.probability?.value).toBe(1);
    for (const s of o.services) expect(s.errorRate?.value).toBe(0);
  });

  it("measures each service's own time, close to what the demo is set to do", () => {
    // The demo's configured work is 2 ms, lognormal 10/40 ms, 5 ms and lognormal 120/400 ms; what
    // traces show is that plus the framework's own time, so a little more (and 90 samples is few).
    const t = (id: string) => byId(o.services, id).serviceTime?.value;
    expect(t("gateway")?.p50Ms).toBeGreaterThan(2);
    expect(t("gateway")?.p50Ms).toBeLessThan(6);
    expect(t("order")?.p50Ms).toBeGreaterThan(10);
    expect(t("order")?.p50Ms).toBeLessThan(15);
    expect(t("payment")?.p50Ms).toBeGreaterThan(5);
    expect(t("payment")?.p50Ms).toBeLessThan(9);
    expect(t("external-payment")?.p50Ms).toBeGreaterThan(100);
    expect(t("external-payment")?.p50Ms).toBeLessThan(150);
  });

  it("says how each time was obtained: derived for services with calls, measured for the leaf", () => {
    expect(byId(o.services, "order").serviceTime?.origin).toBe("inferred");
    expect(byId(o.services, "order").serviceTime?.detail).toContain(
      "minus the time spent in their calls",
    );
    expect(byId(o.services, "external-payment").serviceTime?.origin).toBe("observed");
  });

  it("measures the network between services, well under a millisecond here", () => {
    for (const c of o.calls) {
      expect(c.networkMs?.value).toBeGreaterThanOrEqual(0);
      expect(c.networkMs?.value).toBeLessThan(2);
      expect(c.networkMs?.origin).toBe("inferred");
    }
  });

  it("claims nothing about retries or timeouts: nothing failed, so nothing showed them", () => {
    for (const c of o.calls) {
      expect(c.retries).toBeUndefined();
      expect(c.timeoutMs).toBeUndefined();
    }
  });

  it("leaves out what traces cannot show: threads, queues, breakers", () => {
    for (const s of o.services) {
      expect(s.workers).toBeUndefined();
      expect(s.queueLimit).toBeUndefined();
    }
    for (const c of o.calls) expect(c.breaker).toBeUndefined();
  });
});

describe("the draft built from those traces", () => {
  const o = observe(calm, { fromMs: CALM_FROM, toMs: CALM_FROM + 3000 });
  const built = buildScenario(o);
  if (!built.ok) throw new Error(built.errors.join("; "));

  it("reproduces the end-to-end latency that was observed", () => {
    // Same traces, no knowledge of the demo: the simulated user-facing latency matches what the
    // gateway's own server spans measured.
    const seen = ascending(
      calm
        .filter((s) => s.kind === "server" && s.service === "gateway")
        .map((s) => s.endMs - s.startMs),
    );
    const sim = simulate(built.scenario).summary;
    expect(sim.failed).toBe(0);
    expect(Math.abs((sim.p50Ms ?? 0) / quantile(seen, 0.5) - 1)).toBeLessThan(0.05);
    expect(Math.abs((sim.p95Ms ?? 0) / quantile(seen, 0.95) - 1)).toBeLessThan(0.1);
    expect(Math.abs((sim.p99Ms ?? 0) / quantile(seen, 0.99) - 1)).toBeLessThan(0.15);
  });

  it("marks what traces measured, and asks about the rest", () => {
    const by = Object.fromEntries(built.report.entries.map((e) => [e.path, e]));
    expect(by["traffic.gateway-in.pattern"]?.origin).toBe("observed");
    expect(by["nodes.order.serviceTime"]?.origin).toBe("inferred");
    expect(by["nodes.order.workers"]?.origin).toBe("assumed");
    const asked = built.report.questions.map((q) => q.path);
    expect(asked).toContain("nodes.order.workers");
    expect(asked).toContain("nodes.order.queueLimit");
    expect(asked).toContain("edges.order-payment.policies.timeout");
    expect(asked).not.toContain("nodes.order.serviceTime");
  });
});

describe("observeTraces on requests of the run with the fault", () => {
  const o = observe(trouble);

  it("reads retries as a lower bound: the most attempts seen, minus the first", () => {
    const c = byId(o.calls, "order-payment");
    expect(c.retries?.value).toBe(2);
    expect(c.retries?.origin).toBe("inferred");
    expect(c.retries?.detail).toContain("at least");
    expect(byId(o.calls, "payment-external-payment").retries).toBeUndefined();
  });

  it("estimates the 2 s timeout from the gaps between an attempt left running and its retry", () => {
    // The real timeout is 2000 ms; the gap adds the retry delay (50 to 150 ms), so the lowest
    // cluster of gaps sits just above it.
    const timeout = byId(o.calls, "order-payment").timeoutMs;
    expect(timeout?.origin).toBe("inferred");
    expect(timeout?.value).toBeGreaterThanOrEqual(2000);
    expect(timeout?.value).toBeLessThan(2150);
  });

  it("reports what was seen, not what was configured: a timeout that fires late looks longer", () => {
    // The gateway's timeout is 10 s but its worker pool was saturated, so it fired late.
    const timeout = byId(o.calls, "gateway-order").timeoutMs;
    expect(timeout?.value).toBeGreaterThan(10_000);
    expect(timeout?.detail).toContain("fires late");
  });

  it("does not blame a service for 503 rejections or timeouts it did not cause", () => {
    for (const s of o.services) expect(s.errorRate?.value).toBe(0);
  });

  it("counts the rejected requests, leaves them out of the statistics and says so", () => {
    const r = observeTraces(trouble, { source: "t" });
    if (!r.ok) throw new Error("x");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^order rejected 8 requests with 503/);
  });

  it("asks the user to confirm what it only inferred", () => {
    const built = buildScenario(o);
    if (!built.ok) throw new Error(built.errors.join("; "));
    const asked = Object.fromEntries(built.report.questions.map((q) => [q.path, q.ask]));
    expect(asked["edges.order-payment.policies.retry"]).toContain("At least 2");
    expect(asked["edges.order-payment.policies.timeout"]).toContain("really about");
  });
});

// --- Small hand-made cases for rules the real run does not exercise -------------------------

let n = 0;
function span(o: {
  service: string;
  kind: SpanKind;
  start: number;
  end: number;
  trace?: string;
  parent?: Span | null;
  error?: boolean;
  status?: number;
  peer?: string;
}): Span {
  n++;
  return {
    traceId: o.trace ?? `t${n}`,
    spanId: `s${n}`,
    parentSpanId: o.parent?.spanId ?? null,
    service: o.service,
    name: "x",
    kind: o.kind,
    startMs: o.start,
    endMs: o.end,
    error: o.error ?? false,
    httpStatus: o.status ?? null,
    peer: o.peer ?? null,
  };
}

/** `count` requests, one per 100 ms: each is a server span of "app" that makes the given calls. */
function requests(count: number, calls: (root: Span, t0: number) => Span[]): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < count; i++) {
    const t0 = i * 100;
    const trace = `r${i}-${n++}`;
    const root = span({ service: "app", kind: "server", start: t0, end: t0 + 400, trace });
    out.push(
      root,
      ...calls(root, t0).map((c) => ({ ...c, traceId: trace, parentSpanId: root.spanId })),
    );
  }
  return out;
}

describe("observeTraces rules, on small cases", () => {
  it("a call to a service without server spans is an external API, seen as its callers saw it", () => {
    const spans = requests(10, (_, t0) => [
      span({
        service: "app",
        kind: "client",
        start: t0 + 10,
        end: t0 + 60 + (t0 % 5),
        peer: "api.pay.com:443",
      }),
    ]);
    const o = observe(spans);
    const ext = byId(o.services, "api-pay-com-443");
    expect(ext.kind).toBe("external-api");
    expect(ext.name).toBe("api.pay.com:443");
    expect(ext.serviceTime?.origin).toBe("inferred");
    expect(ext.serviceTime?.value.p50Ms).toBeGreaterThan(49);
    expect(byId(o.calls, "app-api-pay-com-443").networkMs).toBeUndefined();
  });

  it("retries that fail fast (error status) show retries but no timeout", () => {
    const spans = requests(10, (_, t0) => [
      span({
        service: "app",
        kind: "client",
        start: t0 + 10,
        end: t0 + 20,
        error: true,
        peer: "db:5432",
      }),
      span({ service: "app", kind: "client", start: t0 + 120, end: t0 + 160, peer: "db:5432" }),
    ]);
    const c = byId(observe(spans).calls, "app-db-5432");
    expect(c.retries?.value).toBe(1);
    expect(c.timeoutMs).toBeUndefined();
  });

  it("a call that outlives its caller reveals when the caller gave up", () => {
    const spans = requests(10, (_, t0) => [
      span({ service: "app", kind: "client", start: t0 + 50, end: t0 + 3000, peer: "slow:80" }),
    ]);
    // The caller's own span ends 400 ms after it starts: it stopped waiting 350 ms after the call began.
    expect(byId(observe(spans).calls, "app-slow-80").timeoutMs?.value).toBe(350);
  });

  it("scattered gaps say nothing about a timeout", () => {
    const gaps = [310, 777, 1400, 2900, 480, 1800, 2200, 640, 1100, 3300];
    const spans = requests(10, (_, t0) => {
      const g = gaps[(t0 / 100) % gaps.length] as number;
      return [
        span({
          service: "app",
          kind: "client",
          start: t0 + 10,
          end: t0 + 10 + g + 100,
          peer: "x:1",
        }),
        span({ service: "app", kind: "client", start: t0 + 10 + g, end: t0 + 20 + g, peer: "x:1" }),
      ];
    });
    expect(byId(observe(spans).calls, "app-x-1").timeoutMs).toBeUndefined();
  });

  it("counts only requests that start in the window, and keeps a trace whole", () => {
    const spans = requests(30, (_, t0) => [
      span({ service: "app", kind: "client", start: t0 + 10, end: t0 + 50, peer: "d:1" }),
    ]);
    const o = observe(spans, { fromMs: 1000, toMs: 2000 });
    expect(byId(o.traffic, "app-in").rps.value).toBeCloseTo(10, 6);
    expect(o.window.durationMs).toBe(1000);
    const none = observeTraces(spans, { source: "t", fromMs: 5000, toMs: 6000 });
    expect(none).toEqual({ ok: false, errors: ["There are no spans in the window."] });
  });

  it("a server span whose parent was not recorded is not traffic", () => {
    const orphan = span({ service: "app", kind: "server", start: 0, end: 10 });
    orphan.parentSpanId = "missing";
    const r = observeTraces([orphan], { source: "t" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^No request enters the system/);
  });

  it("builds a valid scenario from any of these", () => {
    const spans = requests(20, (_, t0) => [
      span({ service: "app", kind: "client", start: t0 + 10, end: t0 + 50, peer: "d:1" }),
    ]);
    expect(buildScenario(observe(spans)).ok).toBe(true);
  });

  it("is deterministic: the same spans give the same observed system", () => {
    const a = observe(trouble);
    const b = observe(
      parseOtlp(readFileSync(join(import.meta.dirname, "fixtures", "demo-trouble.jsonl"), "utf8"))
        .spans,
    );
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
