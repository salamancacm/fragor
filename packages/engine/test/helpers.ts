import type { NodeSpec, Scenario, TrafficSpec } from "../src";

export function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return {
    id,
    name: id,
    kind: "service",
    workers: 4,
    queueLimit: 50,
    workerModel: "blocking",
    serviceTime: { type: "lognormal", p50Ms: 20, p99Ms: 80 },
    errorRate: 0,
    calls: [],
    ...overrides,
  };
}

export function traffic(id: string, target: string, rps: number): TrafficSpec {
  return { id, target, pattern: { type: "poisson", rps } };
}

/** One service fed by one Poisson source. */
export function singleNode(overrides: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 1,
    name: "single-node",
    seed: 42,
    durationMs: 10_000,
    nodes: [node("svc")],
    edges: [],
    traffic: [traffic("web", "svc", 100)],
    faults: [],
    ...overrides,
  };
}

/** Exact empirical quantile of a sorted array (nearest rank). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  const i = Math.max(0, Math.ceil(q * sorted.length) - 1);
  return sorted[i] as number;
}

export function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}
