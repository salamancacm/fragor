import type { BreakerState, Scenario, SimulationResult } from "@fragor/engine";

/** One chart row per bucket; `t` is the bucket start in seconds. Values are numbers or null. */
export type Row = { t: number } & Record<string, number | null>;

const perSecond = (count: number, bucketMs: number): number => (count * 1000) / bucketMs;

function errorRate(r: SimulationResult, i: number): number | null {
  const g = r.series.global;
  const done = (g.success[i] ?? 0) + (g.degraded[i] ?? 0) + (g.failed[i] ?? 0);
  return done === 0 ? null : (g.failed[i] ?? 0) / done;
}

/**
 * Global rows of the current run, with the previous run overlaid (`prev*` keys) when both runs use
 * the same bucket size, so the before/after difference is visible on the same axis.
 */
export function globalRows(current: SimulationResult, previous: SimulationResult | null): Row[] {
  const { bucketMs } = current.series;
  const prev = previous !== null && previous.series.bucketMs === bucketMs ? previous : null;
  const n = Math.max(current.series.buckets, prev?.series.buckets ?? 0);
  const g = current.series.global;
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const inCurrent = i < current.series.buckets;
    rows.push({
      t: (i * bucketMs) / 1000,
      rps: inCurrent ? (g.rps[i] ?? 0) : null,
      successRps: inCurrent ? perSecond(g.success[i] ?? 0, bucketMs) : null,
      degradedRps: inCurrent ? perSecond(g.degraded[i] ?? 0, bucketMs) : null,
      failedRps: inCurrent ? perSecond(g.failed[i] ?? 0, bucketMs) : null,
      p95: inCurrent ? (g.p95Ms[i] ?? null) : null,
      errorRate: inCurrent ? errorRate(current, i) : null,
      prevRps: prev !== null && i < prev.series.buckets ? (prev.series.global.rps[i] ?? 0) : null,
      prevP95: prev?.series.global.p95Ms[i] ?? null,
      prevErrorRate: prev !== null && i < prev.series.buckets ? errorRate(prev, i) : null,
    });
  }
  return rows;
}

/** One column per node for a per-node gauge (utilization or average queue depth). */
export function nodeRows(r: SimulationResult, field: "utilization" | "queueDepthAvg"): Row[] {
  const { bucketMs, buckets } = r.series;
  const rows: Row[] = [];
  for (let i = 0; i < buckets; i++) {
    const row: Row = { t: (i * bucketMs) / 1000 };
    for (const [id, s] of Object.entries(r.series.nodes)) row[id] = s[field]?.[i] ?? null;
    rows.push(row);
  }
  return rows;
}

export const BREAKER_LEVEL: Record<BreakerState, number> = { closed: 0, "half-open": 1, open: 2 };

/** One column per edge that has a circuit breaker: 0 closed, 1 half-open, 2 open. */
export function breakerRows(r: SimulationResult): { rows: Row[]; edges: string[] } {
  const edges = Object.entries(r.series.edges)
    .filter(([, s]) => s.breakerState !== null)
    .map(([id]) => id);
  const rows: Row[] = [];
  for (let i = 0; i < r.series.buckets; i++) {
    const row: Row = { t: (i * r.series.bucketMs) / 1000 };
    for (const id of edges) {
      const state = r.series.edges[id]?.breakerState?.[i];
      row[id] = state === undefined ? null : BREAKER_LEVEL[state];
    }
    rows.push(row);
  }
  return { rows, edges };
}

export interface FaultWindow {
  id: string;
  fromS: number;
  toS: number;
}

export function faultWindows(s: Scenario): FaultWindow[] {
  return s.faults.map((f) => ({
    id: f.id,
    fromS: f.startMs / 1000,
    toS: (f.startMs + f.durationMs) / 1000,
  }));
}
