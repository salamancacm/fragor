import type { FailureKind, Scenario, SimulationResult } from "@fragor/engine";
import { maxOf, round, runs, sum } from "./series";
import type { Finding } from "./types";

export const DIGEST_DISCLAIMER =
  "Simulation based on the scenario's assumptions, not a prediction. Numbers were computed by the deterministic Fragor engine; explain mechanisms, cite the evidence, do not invent numbers.";

const MAX_TIMELINE = 40;

export interface AnalysisDigest {
  digestVersion: 1;
  disclaimer: string;
  scenario: {
    name: string;
    seed: number;
    durationMs: number;
    nodes: number;
    edges: number;
    traffic: number;
    faults: number;
  };
  result: { fingerprint: string; bucketMs: number; buckets: number };
  summary: {
    roots: number;
    successRate: number | null;
    degradedRate: number | null;
    failedRate: number | null;
    unfinished: number;
    latencyMs: { avg: number | null; p50: number | null; p95: number | null; p99: number | null };
    failureReasons: Partial<Record<FailureKind, number>>;
    goodputRps: number;
    attempts: number;
    retries: number;
    timeouts: number;
    rejected503: number;
    orphanedWork: number;
    discardedWork: number;
  };
  byTraffic: {
    id: string;
    route: string | null;
    roots: number;
    failed: number;
    degraded: number;
    p99Ms: number | null;
  }[];
  timeline: { tMs: number; event: string; ref: string }[];
  timelineTruncated: number;
  nodes: {
    id: string;
    peakUtilization: number | null;
    saturatedMs: number;
    maxQueue: number | null;
    rejected503: number;
    failed: number;
    orphanedWork: number;
    discardedWork: number;
    maxP99Ms: number | null;
  }[];
  edges: {
    id: string;
    from: string;
    to: string;
    invocations: number;
    attempts: number;
    amplification: number | null;
    timeouts: number;
    circuitOpen: number;
    bulkheadFull: number;
    fallbacks: number;
    timeoutsDelayed: number;
    timeoutsLost: number;
    failed: number;
    breakerOpenMs: number | null;
  }[];
  findings: Finding[];
}

const r = (v: number | null): number | null => (v === null ? null : round(v));

/**
 * Compact, stable summary of a run for analysis (a person, a report, or a future AI explainer).
 * Deterministic: same inputs give the same digest. Sized to stay within a few thousand tokens:
 * one line per node and edge, at most MAX_TIMELINE timeline events, findings with evidence.
 */
export function buildAnalysisDigest(
  scenario: Scenario,
  result: SimulationResult,
  findings: readonly Finding[],
): AnalysisDigest {
  const s = result.summary;
  const rate = (n: number) => (s.roots === 0 ? null : round(n / s.roots, 4));
  const { bucketMs, buckets } = result.series;
  const timeline = [
    ...result.events.faults.map((f) => ({
      tMs: round(f.tMs),
      event: `fault-${f.phase}`,
      ref: f.id,
    })),
    ...result.events.breakerTransitions.map((b) => ({
      tMs: round(b.tMs),
      event: `breaker-${b.to}`,
      ref: b.edgeId,
    })),
  ].sort((a, b) => a.tMs - b.tMs || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const reasons: Partial<Record<FailureKind, number>> = {};
  for (const [k, v] of Object.entries(s.failureReasons) as [FailureKind, number][])
    if (v > 0) reasons[k] = v;
  return {
    digestVersion: 1,
    disclaimer: DIGEST_DISCLAIMER,
    scenario: {
      name: scenario.name,
      seed: scenario.seed,
      durationMs: scenario.durationMs,
      nodes: scenario.nodes.length,
      edges: scenario.edges.length,
      traffic: scenario.traffic.length,
      faults: scenario.faults.length,
    },
    result: { fingerprint: result.fingerprint, bucketMs, buckets },
    summary: {
      roots: s.roots,
      successRate: rate(s.success),
      degradedRate: rate(s.degraded),
      failedRate: rate(s.failed),
      unfinished: s.unfinished,
      latencyMs: { avg: r(s.avgLatencyMs), p50: r(s.p50Ms), p95: r(s.p95Ms), p99: r(s.p99Ms) },
      failureReasons: reasons,
      goodputRps: round(s.goodputRps),
      attempts: s.attempts,
      retries: s.retries,
      timeouts: s.timeouts,
      rejected503: s.rejected503,
      orphanedWork: s.orphanedWork,
      discardedWork: s.discardedWork,
    },
    byTraffic: scenario.traffic.map((t) => {
      const x = s.byTraffic[t.id];
      return {
        id: t.id,
        route: t.route ?? null,
        roots: x?.roots ?? 0,
        failed: x?.failed ?? 0,
        degraded: x?.degraded ?? 0,
        p99Ms: r(x?.p99Ms ?? null),
      };
    }),
    timeline: timeline.slice(0, MAX_TIMELINE),
    timelineTruncated: Math.max(0, timeline.length - MAX_TIMELINE),
    nodes: scenario.nodes.map((n) => {
      const x = result.series.nodes[n.id];
      const util = x?.utilization ?? [];
      const saturatedBuckets = runs(buckets, (i) => (util[i] ?? 0) >= 0.95).reduce(
        (a, w) => a + w.to - w.from + 1,
        0,
      );
      return {
        id: n.id,
        peakUtilization: r(maxOf(util)),
        saturatedMs: saturatedBuckets * bucketMs,
        maxQueue: maxOf(x?.queueDepthMax ?? []),
        rejected503: sum(x?.rejected503 ?? []),
        failed: sum(x?.failed ?? []),
        orphanedWork: sum(x?.orphanedWork ?? []),
        discardedWork: sum(x?.discardedWork ?? []),
        maxP99Ms: r(maxOf(x?.p99Ms ?? [])),
      };
    }),
    edges: scenario.edges.map((e) => {
      const x = result.series.edges[e.id];
      const invocations = sum(x?.arrivals ?? []);
      const attempts = sum(x?.attempts ?? []);
      const open =
        x?.breakerState === null || x === undefined
          ? null
          : x.breakerState.filter((st) => st !== "closed").length * bucketMs;
      return {
        id: e.id,
        from: e.from,
        to: e.to,
        invocations,
        attempts,
        amplification: invocations === 0 ? null : round(attempts / invocations),
        timeouts: sum(x?.timeouts ?? []),
        circuitOpen: sum(x?.circuitOpen ?? []),
        bulkheadFull: sum(x?.bulkheadFull ?? []),
        fallbacks: sum(x?.fallbacks ?? []),
        timeoutsDelayed: sum(x?.timeoutsDelayed ?? []),
        timeoutsLost: sum(x?.timeoutsLost ?? []),
        failed: sum(x?.failed ?? []),
        breakerOpenMs: open,
      };
    }),
    findings: [...findings],
  };
}
