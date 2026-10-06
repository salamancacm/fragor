import type { Scenario, SimulationResult } from "@fragor/engine";
import { activeWindow, maxOf, round, sum, toMs } from "./series";
import type { Evidence, Finding, FindingThresholds } from "./types";

/** Quarkus REST Client default read timeout, used when an edge has no timeout policy. */
const DEFAULT_EDGE_TIMEOUT_MS = 30_000;

export function retryAmplification(
  scenario: Scenario,
  result: SimulationResult,
  t: FindingThresholds,
): Finding[] {
  const { bucketMs } = result.series;
  const findings: Finding[] = [];
  for (const edge of scenario.edges) {
    const series = result.series.edges[edge.id];
    if (edge.policies.retry === undefined || series === undefined) continue;
    const invocations = sum(series.arrivals);
    const attempts = sum(series.attempts);
    if (invocations === 0) continue;
    // Attempts rejected by the breaker or the bulkhead never reach the dependency.
    const rejected = sum(series.circuitOpen) + sum(series.bulkheadFull);
    const sent = attempts - rejected;
    const loadFactor = sent / invocations;
    const totalFactor = attempts / invocations;
    if (totalFactor < t.amplificationWarning) continue;
    const w = activeWindow(series.retries);
    const span =
      w === null ? { fromMs: 0, toMs: result.series.buckets * bucketMs } : toMs(w, bucketMs);
    const evidence: Evidence[] = [
      { edgeId: edge.id, ...span, metric: "attempts", value: sum(series.attempts, w ?? undefined) },
      { edgeId: edge.id, ...span, metric: "retries", value: sum(series.retries, w ?? undefined) },
    ];
    if (rejected > 0) {
      evidence.push({
        edgeId: edge.id,
        ...span,
        metric: "circuitOpen",
        value: sum(series.circuitOpen, w ?? undefined),
      });
    }
    const trace = worstTrace(result, edge.id);
    if (trace !== null) evidence.push(trace);
    const loads = loadFactor >= t.amplificationWarning;
    findings.push({
      id: `retry-amplification:${edge.id}`,
      rule: "retry-amplification",
      severity: !loads ? "info" : loadFactor >= t.amplificationCritical ? "critical" : "warning",
      title: loads
        ? `Retries multiplied the load on ${edge.from} -> ${edge.to}`
        : `Retries on ${edge.from} -> ${edge.to} were mostly rejected before the network`,
      summary: loads
        ? `Each call on ${edge.id} sent ${round(loadFactor)} attempts to ${edge.to} on average ` +
          `(${sent} sent for ${invocations} calls), adding load while it was struggling.`
        : `Each call on ${edge.id} made ${round(totalFactor)} attempts on average, but ${rejected} of ` +
          `${attempts} were rejected by the circuit breaker or bulkhead: they did not load ${edge.to}, ` +
          `they added retry delays to each call.`,
      evidence,
    });
  }
  return findings;
}

/** The sampled trace with the most attempts on `edgeId` (ties: earliest root). */
function worstTrace(result: SimulationResult, edgeId: string): Evidence | null {
  let best: { traceId: string; n: number; fromMs: number; toMs: number } | null = null;
  for (const trace of result.traces) {
    const n = trace.spans.filter((s) => s.kind === "attempt" && s.edgeId === edgeId).length;
    if (n > 1 && (best === null || n > best.n)) {
      best = {
        traceId: trace.traceId,
        n,
        fromMs: trace.startMs,
        toMs: trace.endMs ?? trace.startMs,
      };
    }
  }
  return best === null
    ? null
    : {
        traceId: best.traceId,
        fromMs: best.fromMs,
        toMs: best.toMs,
        metric: "attempts",
        value: best.n,
      };
}

export function orphanedWork(
  scenario: Scenario,
  result: SimulationResult,
  t: FindingThresholds,
): Finding[] {
  const { bucketMs } = result.series;
  const findings: Finding[] = [];
  for (const node of scenario.nodes) {
    const series = result.series.nodes[node.id];
    if (series === undefined) continue;
    const orphaned = sum(series.orphanedWork);
    if (orphaned === 0) continue;
    const completed = sum(series.success) + sum(series.degraded) + sum(series.failed);
    const ratio = completed === 0 ? 1 : orphaned / completed;
    const w = activeWindow(series.orphanedWork);
    const span =
      w === null ? { fromMs: 0, toMs: result.series.buckets * bucketMs } : toMs(w, bucketMs);
    const evidence: Evidence[] = [
      { nodeId: node.id, ...span, metric: "orphanedWork", value: orphaned },
    ];
    for (const edge of scenario.edges.filter((e) => e.to === node.id)) {
      const timeouts = sum(result.series.edges[edge.id]?.timeouts ?? []);
      if (timeouts > 0)
        evidence.push({ edgeId: edge.id, ...span, metric: "timeouts", value: timeouts });
    }
    findings.push({
      id: `orphaned-work:${node.id}`,
      rule: "orphaned-work",
      severity: ratio >= t.orphanedCriticalRatio ? "critical" : "warning",
      title: `${node.name} kept working for callers that had given up`,
      summary:
        `${orphaned} requests (${round(ratio * 100, 1)}% of what ${node.name} completed) finished after ` +
        `their caller timed out: the work consumed workers but its result was discarded.`,
      evidence,
    });
  }
  return findings;
}

export function missingTimeout(
  scenario: Scenario,
  result: SimulationResult,
  t: FindingThresholds,
): Finding[] {
  const effective = scenario.options?.defaultEdgeTimeoutMs ?? DEFAULT_EDGE_TIMEOUT_MS;
  const end = result.series.buckets * result.series.bucketMs;
  const findings: Finding[] = [];
  for (const edge of scenario.edges) {
    if (edge.policies.timeout !== undefined) continue;
    const series = result.series.edges[edge.id];
    const p99 = maxOf(series?.p99Ms ?? []) ?? 0;
    const timeouts = sum(series?.timeouts ?? []);
    const risky = timeouts > 0 || p99 >= t.missingTimeoutP99Ratio * effective;
    findings.push({
      id: `missing-timeout:${edge.id}`,
      rule: "missing-timeout",
      severity: risky ? "warning" : "info",
      title: `No timeout policy on ${edge.from} -> ${edge.to}`,
      summary:
        `Calls on ${edge.id} only stop waiting after the default ${effective} ms ` +
        `(Quarkus REST Client read timeout); the slowest calls took up to ${round(p99)} ms (p99 per bucket)` +
        `${timeouts > 0 ? ` and ${timeouts} attempts hit that default` : ""}.`,
      evidence: [
        { edgeId: edge.id, fromMs: 0, toMs: end, metric: "p99Ms", value: round(p99) },
        { edgeId: edge.id, fromMs: 0, toMs: end, metric: "timeouts", value: timeouts },
      ],
    });
  }
  return findings;
}
