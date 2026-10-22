import type { Scenario, TrafficPattern } from "@fragor/engine";
import { DEFAULT_BREAKER, DEFAULT_RETRY, type PatchOp } from "@fragor/scenarios";

export { DEFAULT_BREAKER, DEFAULT_RETRY } from "@fragor/scenarios";

export interface EdgeParams {
  /** Attempt timeout; null = no timeout policy (Quarkus default read timeout applies). */
  timeoutMs: number | null;
  /** Timeout enforced on the caller's worker pool (synchronous @Timeout in Quarkus). */
  timeoutOnCallerPool: boolean;
  /** Retries after the first attempt; 0 = no retry policy. */
  retries: number;
  breaker: boolean;
}

/** The knobs of the parameters panel. Applied to a scenario as typed patches. */
export interface Params {
  /** Multiplies every traffic rate. */
  trafficFactor: number;
  edges: Record<string, EdgeParams>;
}

export function paramsOf(s: Scenario): Params {
  const edges: Record<string, EdgeParams> = {};
  for (const e of s.edges) {
    edges[e.id] = {
      timeoutMs: e.policies.timeout?.valueMs ?? null,
      timeoutOnCallerPool: e.policies.timeout?.enforcement === "caller-pool",
      retries: e.policies.retry?.maxRetries ?? 0,
      breaker: e.policies.circuitBreaker !== undefined,
    };
  }
  return { trafficFactor: 1, edges };
}

function scaledPattern(p: TrafficPattern, f: number): TrafficPattern {
  switch (p.type) {
    case "constant":
    case "poisson":
      return { ...p, rps: p.rps * f };
    case "ramp":
      return { ...p, fromRps: p.fromRps * f, toRps: p.toRps * f };
    case "spike":
      return { ...p, baseRps: p.baseRps * f, peakRps: p.peakRps * f };
  }
}

/** Patch ops turning `base` into the scenario described by `params` (only what differs). */
export function patchFor(base: Scenario, params: Params): PatchOp[] {
  const ops: PatchOp[] = [];
  if (params.trafficFactor !== 1) {
    for (const t of base.traffic) {
      ops.push({
        op: "set",
        path: ["traffic", t.id, "pattern"],
        value: scaledPattern(t.pattern, params.trafficFactor),
      });
    }
  }
  for (const e of base.edges) {
    const want = params.edges[e.id];
    if (want === undefined) continue;
    const path = (...rest: string[]) => ["edges", e.id, "policies", ...rest];
    const have = e.policies;
    const haveOnPool = have.timeout?.enforcement === "caller-pool";
    if (
      want.timeoutMs !== (have.timeout?.valueMs ?? null) ||
      (want.timeoutMs !== null && want.timeoutOnCallerPool !== haveOnPool)
    ) {
      ops.push(
        want.timeoutMs === null
          ? { op: "unset", path: path("timeout") }
          : {
              op: "set",
              path: path("timeout"),
              value: want.timeoutOnCallerPool
                ? { valueMs: want.timeoutMs, enforcement: "caller-pool" }
                : { valueMs: want.timeoutMs },
            },
      );
    }
    if (want.retries !== (have.retry?.maxRetries ?? 0)) {
      if (want.retries === 0) ops.push({ op: "unset", path: path("retry") });
      else if (have.retry !== undefined)
        ops.push({ op: "set", path: path("retry", "maxRetries"), value: want.retries });
      else
        ops.push({
          op: "set",
          path: path("retry"),
          value: { ...DEFAULT_RETRY, maxRetries: want.retries },
        });
    }
    if (want.breaker !== (have.circuitBreaker !== undefined)) {
      ops.push(
        want.breaker
          ? { op: "set", path: path("circuitBreaker"), value: DEFAULT_BREAKER }
          : { op: "unset", path: path("circuitBreaker") },
      );
    }
  }
  return ops;
}

/** Short human description of a patch op for the "what-if" list. */
export function describeOp(op: PatchOp): string {
  const path = (p: string | readonly string[]) => (typeof p === "string" ? p : p.join("."));
  switch (op.op) {
    case "set":
      return `${path(op.path)} = ${JSON.stringify(op.value)}`;
    case "unset":
      return `remove ${path(op.path)}`;
    case "add-node":
      return `add node ${op.node.id}`;
    case "remove-node":
      return `remove node ${op.nodeId}`;
    case "add-edge":
      return `add edge ${op.edge.id}`;
    case "remove-edge":
      return `remove edge ${op.edgeId}`;
  }
}
