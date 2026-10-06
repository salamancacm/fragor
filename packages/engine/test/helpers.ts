import type { ClientPolicies, FaultSpec, NodeSpec, Scenario, TrafficSpec } from "../src";

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

export interface ChainOptions {
  policies?: ClientPolicies;
  server?: Partial<NodeSpec>;
  client?: Partial<NodeSpec>;
  rps?: number;
  durationMs?: number;
  faults?: FaultSpec[];
  options?: Scenario["options"];
  bucketMs?: number;
}

/**
 * client -> server through edge "c-s" (1 ms constant latency each way). The client has huge
 * capacity and no own service time, so root outcomes reflect the edge and the server.
 */
export function chain(o: ChainOptions = {}): Scenario {
  return {
    schemaVersion: 1,
    name: "chain",
    seed: 42,
    durationMs: o.durationMs ?? 10_000,
    ...(o.options === undefined ? {} : { options: o.options }),
    metrics: { bucketMs: o.bucketMs ?? 1000 },
    nodes: [
      node("client", {
        workers: 100_000,
        queueLimit: null,
        serviceTime: { type: "constant", ms: 0 },
        calls: [{ edgeId: "c-s" }],
        ...o.client,
      }),
      node("server", {
        workers: 100_000,
        queueLimit: null,
        serviceTime: { type: "constant", ms: 10 },
        ...o.server,
      }),
    ],
    edges: [
      {
        id: "c-s",
        from: "client",
        to: "server",
        latency: { type: "constant", ms: 1 },
        packetLoss: 0,
        policies: o.policies ?? {},
      },
    ],
    traffic: [{ id: "web", target: "client", pattern: { type: "constant", rps: o.rps ?? 10 } }],
    faults: o.faults ?? [],
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
