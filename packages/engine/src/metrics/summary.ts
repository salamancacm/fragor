import { hashHex } from "../core/hash";
import type { Ms, SimulationResult, SimulationSummary } from "../model/types";
import type { MetricsCollector } from "./collector";
import type { CounterField } from "./series-builder";

interface RootStats {
  created: number;
  completed: number;
  outcomes: { success: number; degraded: number; failed: number };
  reasons: SimulationSummary["failureReasons"];
  latency: { avg: number | null; p50: number | null; p95: number | null; p99: number | null };
  byTraffic: SimulationSummary["byTraffic"];
}

function sumOver(m: MetricsCollector["nodes"], field: CounterField): number {
  let total = 0;
  for (const b of m.values()) total += b.total(field);
  return total;
}

export function buildSummary(
  roots: RootStats,
  metrics: MetricsCollector,
  durationMs: Ms,
): SimulationSummary {
  return {
    roots: roots.created,
    success: roots.outcomes.success,
    degraded: roots.outcomes.degraded,
    failed: roots.outcomes.failed,
    unfinished: roots.created - roots.completed,
    failureReasons: roots.reasons,
    avgLatencyMs: roots.latency.avg,
    p50Ms: roots.latency.p50,
    p95Ms: roots.latency.p95,
    p99Ms: roots.latency.p99,
    attempts: sumOver(metrics.edges, "attempts"),
    retries: sumOver(metrics.edges, "retries"),
    timeouts: sumOver(metrics.edges, "timeouts"),
    rejected503: sumOver(metrics.nodes, "rejected503"),
    orphanedWork: sumOver(metrics.nodes, "orphanedWork"),
    orphanedResponses: sumOver(metrics.edges, "orphanedResponses"),
    goodputRps: roots.outcomes.success / (durationMs / 1000),
    circuitOpen: sumOver(metrics.edges, "circuitOpen"),
    bulkheadFull: sumOver(metrics.edges, "bulkheadFull"),
    fallbacks: sumOver(metrics.edges, "fallbacks"),
    byTraffic: roots.byTraffic,
  };
}

/** Hash of the whole result except stats.wallClockMs and the fingerprint itself. */
export function computeFingerprint(result: Omit<SimulationResult, "fingerprint">): string {
  const { stats, ...rest } = result;
  return hashHex(JSON.stringify({ ...rest, eventsProcessed: stats.eventsProcessed }));
}
