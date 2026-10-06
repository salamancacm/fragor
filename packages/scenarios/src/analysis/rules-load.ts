import type { Scenario, SimulationResult } from "@fragor/engine";
import { maxOf, mean, round, runs, sum, toMs, type Window } from "./series";
import type { Evidence, Finding, FindingThresholds } from "./types";

/** Saturation runs per node: utilization >= threshold for at least saturationMinMs. */
export function saturationWindows(
  result: SimulationResult,
  t: FindingThresholds,
): Map<string, Window[]> {
  const { bucketMs, buckets } = result.series;
  const minBuckets = Math.max(1, Math.ceil(t.saturationMinMs / bucketMs));
  const out = new Map<string, Window[]>();
  for (const [nodeId, series] of Object.entries(result.series.nodes)) {
    const util = series.utilization ?? [];
    const found = runs(buckets, (i) => (util[i] ?? 0) >= t.saturationUtilization).filter(
      (w) => w.to - w.from + 1 >= minBuckets,
    );
    if (found.length > 0) out.set(nodeId, found);
  }
  return out;
}

export function workerSaturation(
  scenario: Scenario,
  result: SimulationResult,
  saturated: Map<string, Window[]>,
): Finding[] {
  const { bucketMs } = result.series;
  const findings: Finding[] = [];
  for (const node of scenario.nodes) {
    const windows = saturated.get(node.id);
    const series = result.series.nodes[node.id];
    if (windows === undefined || series === undefined) continue;
    const longest = windows.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
    const span = toMs(longest, bucketMs);
    const shed = sum(series.rejected503, longest);
    const maxQueue = maxOf(series.queueDepthMax ?? [], longest) ?? 0;
    const queueFull = node.queueLimit !== null && maxQueue >= node.queueLimit;
    const seconds = round((span.toMs - span.fromMs) / 1000, 1);
    const evidence: Evidence[] = [
      {
        nodeId: node.id,
        ...span,
        metric: "utilization",
        value: round(mean(series.utilization ?? [], longest), 3),
      },
      { nodeId: node.id, ...span, metric: "queueDepthMax", value: maxQueue },
    ];
    if (shed > 0) evidence.push({ nodeId: node.id, ...span, metric: "rejected503", value: shed });
    findings.push({
      id: `worker-saturation:${node.id}`,
      rule: "worker-saturation",
      severity: shed > 0 || queueFull ? "critical" : "warning",
      title: `${node.name} ran out of workers`,
      summary:
        `All ${node.workers} workers of ${node.name} were busy for ${seconds}s ` +
        `(from ${round(span.fromMs / 1000, 1)}s, ${windows.length} saturation period(s)); ` +
        `queue peaked at ${maxQueue}${shed > 0 ? ` and ${shed} requests were shed with 503` : ""}.`,
      evidence,
    });
  }
  return findings;
}

/**
 * Saturation that spread upstream: a caller saturated at the same time as or after the
 * dependency it calls. One finding per origin (a saturated node whose own saturation was not
 * preceded by a saturated dependency).
 */
export function cascadePropagation(
  scenario: Scenario,
  result: SimulationResult,
  saturated: Map<string, Window[]>,
): Finding[] {
  const { bucketMs } = result.series;
  const start = (id: string): number => saturated.get(id)?.[0]?.from ?? Number.POSITIVE_INFINITY;
  // upstream.get(B) = callers A of B that saturated at or after B
  const upstream = new Map<string, string[]>();
  const caused = new Set<string>();
  for (const e of scenario.edges) {
    if (!saturated.has(e.from) || !saturated.has(e.to) || e.from === e.to) continue;
    if (start(e.from) < start(e.to)) continue;
    upstream.set(e.to, [...(upstream.get(e.to) ?? []), e.from]);
    caused.add(e.from);
  }
  const entries = new Set(scenario.traffic.map((t) => t.target));
  const names = new Map(scenario.nodes.map((n) => [n.id, n.name]));
  const findings: Finding[] = [];
  for (const origin of scenario.nodes.map((n) => n.id)) {
    if (!upstream.has(origin) || caused.has(origin)) continue;
    const depth = collect(origin, upstream);
    const chain = [...depth.keys()].sort(
      (a, b) => start(a) - start(b) || (depth.get(a) ?? 0) - (depth.get(b) ?? 0),
    );
    const reachesEntry = chain.some((id) => entries.has(id));
    findings.push({
      id: `cascade-propagation:${origin}`,
      rule: "cascade-propagation",
      severity: reachesEntry ? "critical" : "warning",
      title: `Saturation spread upstream from ${names.get(origin) ?? origin}`,
      summary: `Workers saturated in order: ${chain.map((id) => `${names.get(id) ?? id} (${round((start(id) * bucketMs) / 1000, 1)}s)`).join(" -> ")}.${reachesEntry ? " It reached an entry point, so users were affected." : ""}`,
      evidence: chain.map((nodeId) => {
        const w = saturated.get(nodeId)?.[0] as Window;
        const util = result.series.nodes[nodeId]?.utilization ?? [];
        return {
          nodeId,
          ...toMs(w, bucketMs),
          metric: "utilization",
          value: round(mean(util, w), 3),
        };
      }),
    });
  }
  return findings;
}

/** Breadth-first distance from the origin to every node the saturation reached upstream. */
function collect(origin: string, upstream: Map<string, string[]>): Map<string, number> {
  const depth = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const up of upstream.get(id) ?? []) {
      if (!depth.has(up)) {
        depth.set(up, (depth.get(id) ?? 0) + 1);
        queue.push(up);
      }
    }
  }
  return depth;
}
