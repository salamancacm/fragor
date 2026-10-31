import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMetrics,
  type ObservedSystem,
  parseProm,
  type ServiceMetrics,
  summarizeMetrics,
} from "../src";
import { quarkusDemo } from "./fixtures/quarkus-demo";

const snapshot = (service: string, label: string) =>
  parseProm(
    readFileSync(
      join(import.meta.dirname, "fixtures", "metrics", `${service}-${label}.prom`),
      "utf8",
    ),
  ).samples;

/** What the demo's services reported in the calm 4 s of the capture (k6 at 30 req/s). */
function calm(service: string): ServiceMetrics {
  const r = summarizeMetrics(snapshot(service, "calm-b"), snapshot(service, "calm-a"));
  if (!r.ok) throw new Error(r.error);
  return r.metrics;
}

describe("summarizeMetrics", () => {
  it("turns two snapshots into rates, using the service's own uptime for the elapsed time", () => {
    const gateway = calm("gateway");
    expect(gateway.sinceStart).toBe(false);
    expect(gateway.seconds).toBeCloseTo(4.046, 2);
    // k6 sent 30 req/s: the counters over the window agree within sampling error
    expect(gateway.server.rps).toBeGreaterThan(28);
    expect(gateway.server.rps).toBeLessThan(32);
    expect(gateway.server.meanMs).toBeGreaterThan(0);
  });

  it("sees the calls a service makes by the name of its client", () => {
    const order = calm("order");
    const payment = order.clients.payment;
    expect(payment).toBeDefined();
    expect(payment?.address).toBe("payment:8082");
    expect(payment?.rps).toBeGreaterThan(28);
    // a client call lasts at least as long as the server's work on the other side
    expect(payment?.meanMs).toBeGreaterThan(calm("payment").server.meanMs ?? 0);
  });

  it("splits server errors from the rest", () => {
    const after = snapshot("order", "trouble-b");
    const before = snapshot("order", "calm-b");
    const r = summarizeMetrics(after, before);
    if (!r.ok) throw new Error(r.error);
    expect(r.metrics.server.serverErrorShare).toBeGreaterThan(0);
    expect(calm("order").server.serverErrorShare).toBe(0);
  });

  it("with one snapshot, averages over the whole uptime and says so", () => {
    const r = summarizeMetrics(snapshot("payment", "calm-b"), null);
    if (!r.ok) throw new Error(r.error);
    expect(r.metrics.sinceStart).toBe(true);
    expect(r.metrics.seconds).toBeCloseTo(245.671, 2);
    expect(r.metrics.server.rps).toBeGreaterThan(0);
  });

  it("refuses snapshots whose counters went down (a restart in between)", () => {
    const r = summarizeMetrics(snapshot("order", "calm-a"), snapshot("order", "calm-b"));
    expect(r.ok).toBe(false);
  });

  it("refuses a snapshot without uptime or without HTTP server metrics", () => {
    expect(summarizeMetrics(parseProm("a 1").samples, null).ok).toBe(false);
    expect(summarizeMetrics(parseProm("process_uptime_seconds 5").samples, null).ok).toBe(false);
  });

  it("reads the fault tolerance metrics of the guarded method", () => {
    const order = calm("order");
    expect(order.guards).toHaveLength(1);
    const g = order.guards[0];
    expect(g?.method).toBe("fragor.demo.order.PaymentGateway.charge");
    expect(g?.fallback).toBe("notDefined");
    expect(g?.circuitBreaker).toBe(false);
    expect(g?.bulkhead).toBe(false);
    expect(calm("gateway").guards.map((x) => x.method)).toEqual([
      "fragor.demo.gateway.OrderGateway.create",
    ]);
  });

  it("counts retries and timeouts of the window", () => {
    const r = summarizeMetrics(snapshot("order", "trouble-b"), snapshot("order", "calm-b"));
    if (!r.ok) throw new Error(r.error);
    const g = r.metrics.guards[0];
    expect(g?.timedOut).toBeGreaterThan(0);
    expect(g?.retries).toBeGreaterThan(0);
  });
});

/** The demo without the policy flags its configuration gives, to see what the metrics add. */
function bare() {
  const copy = structuredClone(quarkusDemo);
  for (const c of copy.calls) {
    delete c.breaker;
    delete c.fallback;
  }
  return copy;
}

describe("applyMetrics", () => {
  const all = () =>
    ["gateway", "order", "payment", "external-payment"].map((service) => ({
      service,
      metrics: calm(service),
    }));

  it("replaces the traffic guess with the rate the counters show, and says where it came from", () => {
    const r = applyMetrics(quarkusDemo, all());
    const web = r.observed.traffic.find((t) => t.id === "web");
    expect(web?.rps.origin).toBe("observed");
    expect(web?.rps.value).toBeGreaterThan(28);
    expect(web?.rps.value).toBeLessThan(32);
    expect(web?.rps.detail).toContain("http_server_requests_seconds_count");
    // 100 (configured) vs 30 (observed) is a difference worth a warning
    expect(r.warnings.some((w) => w.includes("gateway") && w.includes("100"))).toBe(true);
  });

  it("learns from the fault tolerance metrics that a call has no breaker and no fallback", () => {
    const r = applyMetrics(bare(), all());
    const call = r.observed.calls.find((c) => c.id === "order-payment");
    expect(call?.breaker).toMatchObject({ value: false, origin: "inferred" });
    expect(call?.fallback).toMatchObject({ value: false, origin: "observed" });
    expect(call?.breaker?.detail).toContain("ft_circuitbreaker");
    expect(call?.fallback?.detail).toContain("ft_invocations_total");
  });

  it("detects a breaker and a fallback by their series", () => {
    const withBreaker = parseProm(
      [
        "process_uptime_seconds 100",
        'http_server_requests_seconds_count{status="200",outcome="SUCCESS",uri="/orders"} 10',
        'http_server_requests_seconds_sum{status="200",outcome="SUCCESS",uri="/orders"} 1',
        'ft_invocations_total{fallback="applied",method="a.B.c",result="valueReturned"} 3',
        'ft_invocations_total{fallback="notApplied",method="a.B.c",result="valueReturned"} 7',
        'ft_circuitbreaker_calls_total{circuitBreakerResult="success",method="a.B.c"} 7',
      ].join("\n"),
    ).samples;
    const s = summarizeMetrics(withBreaker, null);
    if (!s.ok) throw new Error(s.error);
    expect(s.metrics.guards[0]).toMatchObject({
      method: "a.B.c",
      fallback: "defined",
      circuitBreaker: true,
    });
    const r = applyMetrics(bare(), [{ service: "order", metrics: s.metrics }]);
    const call = r.observed.calls.find((c) => c.id === "order-payment");
    expect(call?.breaker).toMatchObject({ value: true, origin: "observed" });
    expect(call?.fallback).toMatchObject({ value: true, origin: "observed" });
  });

  it("keeps what the configuration says, and warns when the metrics disagree", () => {
    const agree = applyMetrics(quarkusDemo, all());
    const call = agree.observed.calls.find((c) => c.id === "order-payment");
    expect(call?.breaker).toMatchObject({ value: false, origin: "config" });
    expect(agree.warnings.filter((w) => w.includes("says breaker"))).toEqual([]);
    const s = summarizeMetrics(
      parseProm(
        [
          "process_uptime_seconds 100",
          'http_server_requests_seconds_count{status="200"} 10',
          'http_server_requests_seconds_sum{status="200"} 1',
          'ft_invocations_total{fallback="notDefined",method="a.B.c",result="valueReturned"} 7',
          'ft_circuitbreaker_calls_total{circuitBreakerResult="success",method="a.B.c"} 7',
        ].join("\n"),
      ).samples,
      null,
    );
    if (!s.ok) throw new Error(s.error);
    const d = applyMetrics(quarkusDemo, [{ service: "order", metrics: s.metrics }]);
    expect(d.observed.calls.find((c) => c.id === "order-payment")?.breaker?.origin).toBe("config");
    expect(
      d.warnings.some(
        (w) => w.includes("order → payment") && w.includes("config says breaker=false"),
      ),
    ).toBe(true);
  });

  it("never overrides what the user said, and does not guess which call a guard belongs to", () => {
    const user = structuredClone(quarkusDemo);
    const call = user.calls.find((c) => c.id === "order-payment");
    if (call === undefined) throw new Error("fixture changed");
    call.breaker = { value: true, origin: "user", detail: "given by the user" };
    const two: ObservedSystem = {
      ...user,
      calls: [...user.calls, { id: "order-extra", from: "order", to: "external-payment" }],
    };
    const r = applyMetrics(two, all());
    // order now has two outgoing calls: the guard cannot be attributed to either
    const same = r.observed.calls.find((c) => c.id === "order-payment");
    expect(same?.breaker).toMatchObject({ value: true, origin: "user" });
    expect(same?.fallback).toMatchObject({ origin: "config" });
    expect(r.warnings.some((w) => w.includes("order") && w.includes("2 calls"))).toBe(true);
  });

  it("warns about a service it does not know", () => {
    const r = applyMetrics(quarkusDemo, [{ service: "ghost", metrics: calm("order") }]);
    expect(r.warnings.some((w) => w.includes("ghost"))).toBe(true);
    expect(r.observed).toEqual(quarkusDemo);
  });

  it("warns when the rates cover the whole uptime instead of a window", () => {
    const s = summarizeMetrics(snapshot("gateway", "calm-b"), null);
    if (!s.ok) throw new Error(s.error);
    const r = applyMetrics(quarkusDemo, [{ service: "gateway", metrics: s.metrics }]);
    expect(r.warnings.some((w) => w.includes("since the service started"))).toBe(true);
  });
});
