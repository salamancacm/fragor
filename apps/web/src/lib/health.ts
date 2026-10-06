import type { BreakerState, SimulationResult } from "@fragor/engine";

export type Health = "idle" | "healthy" | "stressed" | "critical";

export interface NodeHealth {
  health: Health;
  utilization: number | null;
  failRatio: number | null;
  queueDepth: number | null;
  arrivals: number;
}

export interface EdgeHealth {
  health: Health;
  failRatio: number | null;
  breaker: BreakerState | null;
  arrivals: number;
}

/** Thresholds of the health colors (display only; findings use their own rules). */
export const HEALTH_THRESHOLDS = {
  stressedUtilization: 0.8,
  criticalUtilization: 0.95,
  stressedFailRatio: 0.05,
  criticalFailRatio: 0.25,
} as const;

function failRatio(failed: number, total: number): number | null {
  return total === 0 ? null : failed / total;
}

function classify(utilization: number | null, fail: number | null, active: boolean): Health {
  if (!active) return "idle";
  const t = HEALTH_THRESHOLDS;
  if ((utilization ?? 0) >= t.criticalUtilization || (fail ?? 0) >= t.criticalFailRatio)
    return "critical";
  if ((utilization ?? 0) >= t.stressedUtilization || (fail ?? 0) >= t.stressedFailRatio)
    return "stressed";
  return "healthy";
}

/** Health of a node in bucket `i` of a result. */
export function nodeHealth(result: SimulationResult, nodeId: string, i: number): NodeHealth {
  const s = result.series.nodes[nodeId];
  if (s === undefined)
    return { health: "idle", utilization: null, failRatio: null, queueDepth: null, arrivals: 0 };
  const done = (s.success[i] ?? 0) + (s.degraded[i] ?? 0) + (s.failed[i] ?? 0);
  const utilization = s.utilization?.[i] ?? null;
  const fail = failRatio(s.failed[i] ?? 0, done);
  const arrivals = s.arrivals[i] ?? 0;
  return {
    health: classify(utilization, fail, arrivals > 0 || done > 0 || (utilization ?? 0) > 0),
    utilization,
    failRatio: fail,
    queueDepth: s.queueDepthAvg?.[i] ?? null,
    arrivals,
  };
}

/** Health of an edge in bucket `i`: an open breaker is critical, half-open is stressed. */
export function edgeHealth(result: SimulationResult, edgeId: string, i: number): EdgeHealth {
  const s = result.series.edges[edgeId];
  if (s === undefined) return { health: "idle", failRatio: null, breaker: null, arrivals: 0 };
  const done = (s.success[i] ?? 0) + (s.degraded[i] ?? 0) + (s.failed[i] ?? 0);
  const fail = failRatio(s.failed[i] ?? 0, done);
  const breaker = s.breakerState?.[i] ?? null;
  const arrivals = s.arrivals[i] ?? 0;
  let health = classify(null, fail, arrivals > 0 || done > 0);
  if (breaker === "open") health = "critical";
  else if (breaker === "half-open" && health !== "critical") health = "stressed";
  return { health, failRatio: fail, breaker, arrivals };
}
