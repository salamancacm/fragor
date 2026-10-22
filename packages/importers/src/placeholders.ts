import type { LatencyQuantiles } from "./observed";

/**
 * Values used when the data says nothing. They are round numbers chosen to let the simulation run,
 * NOT framework defaults (those are not verified here), and every use is reported as `assumed`
 * (and, where it matters, as a question for the user).
 */
export const PLACEHOLDERS = {
  /** Worker threads of a service whose size is unknown. */
  workers: 50,
  /** Waiting queue of a service whose size is unknown. */
  queueLimit: 100,
  workerModel: "blocking" as const,
  /** Own processing time when none was observed, as a constant. */
  serviceTimeMs: 10,
  errorRate: 0,
  /** One-way network latency. */
  networkMs: 1,
  probability: 1,
  packetLoss: 0,
  /** A third party's API is modeled roomy, so its slowness comes from faults, not from saturation. */
  externalWorkers: 1000,
  /** Simulated length of the draft; independent of how long the observed window was. */
  horizonMs: 60_000,
  seed: 1,
} as const;

/** Where to look, per question, in a Quarkus application (the keys the demo sets and validates). */
export const HINTS = {
  workers: "Quarkus: quarkus.thread-pool.max-threads",
  queueLimit: "Quarkus: quarkus.thread-pool.queue-size",
  workerModel: "blocking if the thread waits for the dependency, async (reactive) if not",
  serviceTime: "p50 and p99 of the service's own time, without its dependency calls",
  timeout: "@Timeout, or quarkus.rest-client.<name>.read-timeout (30 s when unset)",
  breaker: "@CircuitBreaker parameters (SmallRye defaults are used until you say)",
  fallback: "@Fallback on the calling method",
} as const;

export const constantTime = (ms: number): { type: "constant"; ms: number } => ({
  type: "constant",
  ms,
});

export const lognormal = (
  q: LatencyQuantiles,
): { type: "lognormal"; p50Ms: number; p99Ms: number } => ({
  type: "lognormal",
  p50Ms: q.p50Ms,
  p99Ms: q.p99Ms,
});
