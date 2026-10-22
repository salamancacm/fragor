import type { ObservedSystem, Sourced } from "../../src";

/** A value known from the demo's own configuration (its `application.properties` and sources). */
const cfg = <T>(value: T, detail: string): Sourced<T> => ({ value, origin: "config", detail });

const pool = (service: string, workers: number, queue: number) => ({
  workers: cfg(
    workers,
    `${service}/application.properties: quarkus.thread-pool.max-threads=${workers}`,
  ),
  queueLimit: cfg(
    queue,
    `${service}/application.properties: quarkus.thread-pool.queue-size=${queue}`,
  ),
  workerModel: cfg("blocking" as const, "the demo's endpoints block a thread while they wait"),
  errorRate: cfg(0, "the demo's services never fail on their own"),
});

const call = (id: string, from: string, to: string, networkMs: number, timeoutMs: number) => ({
  id,
  from,
  to,
  networkMs: cfg(networkMs, "scenario of the demo (examples/quarkus-demo/fragor)"),
  timeoutMs: cfg(timeoutMs, `read timeout of the ${from} REST client toward ${to}`),
  breaker: cfg(false, "the baseline has no @CircuitBreaker"),
  fallback: cfg(false, "the baseline has no @Fallback"),
});

/**
 * The Quarkus demo (examples/quarkus-demo) described the way an importer would, from its
 * configuration. `examples/quarkus-demo/fragor/baseline-read-timeout.json` is the hand-written
 * mirror a correct import must reproduce. `probability` is left out on purpose: it is a placeholder.
 */
export const quarkusDemo: ObservedSystem = {
  version: 1,
  name: "quarkus-demo-baseline-read-timeout",
  source: "examples/quarkus-demo configuration",
  window: { description: "k6 constant-arrival-rate run of 60 s", durationMs: 60_000 },
  services: [
    {
      id: "gateway",
      name: "API Gateway",
      kind: "service",
      ...pool("gateway", 200, 1000),
      serviceTime: cfg({ p50Ms: 2, p99Ms: 2 }, "SimulatedWork of the gateway: 2 ms"),
    },
    {
      id: "order",
      name: "Order Service",
      kind: "service",
      ...pool("order", 100, 200),
      serviceTime: cfg({ p50Ms: 10, p99Ms: 40 }, "SimulatedWork of order: lognormal 10/40 ms"),
    },
    {
      id: "payment",
      name: "Payment Service",
      kind: "service",
      ...pool("payment", 50, 100),
      serviceTime: cfg({ p50Ms: 5, p99Ms: 5 }, "SimulatedWork of payment: 5 ms"),
    },
    {
      id: "external-payment",
      name: "External Payment API",
      kind: "external-api",
      ...pool("external-payment", 1000, 1000),
      serviceTime: cfg(
        { p50Ms: 120, p99Ms: 400 },
        "SimulatedWork of the provider: lognormal 120/400 ms",
      ),
    },
  ],
  calls: [
    { ...call("gateway-order", "gateway", "order", 1, 10_000), retries: cfg(0, "no @Retry") },
    {
      ...call("order-payment", "order", "payment", 1, 2000),
      retries: cfg(3, "@Retry(maxRetries = 3) on the order -> payment client"),
      retryDelayMs: cfg(100, "@Retry(delay = 100)"),
      retryJitterMs: cfg(50, "@Retry(jitter = 50)"),
    },
    {
      ...call("payment-external", "payment", "external-payment", 5, 30_000),
      retries: cfg(0, "no @Retry"),
    },
  ],
  traffic: [
    {
      id: "web",
      target: "gateway",
      rps: cfg(100, "k6 script: constant-arrival-rate of 100 requests per second"),
      arrivals: cfg("constant", "k6 constant-arrival-rate executor"),
    },
  ],
};
