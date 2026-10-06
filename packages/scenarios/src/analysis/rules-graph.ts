import type { Scenario, SimulationResult, TrafficSpec } from "@fragor/engine";
import type { Window } from "./series";
import { sum } from "./series";
import type { Evidence, Finding } from "./types";

/**
 * Nodes a request of `traffic` cannot succeed without: reached through calls that are required,
 * always made (probability 1), match the route, and whose edge has no fallback.
 */
export function requiredNodes(scenario: Scenario, traffic: TrafficSpec): Set<string> {
  const nodes = new Map(scenario.nodes.map((n) => [n.id, n]));
  const edges = new Map(scenario.edges.map((e) => [e.id, e]));
  const required = new Set<string>();
  const visit = (id: string): void => {
    if (required.has(id)) return;
    required.add(id);
    for (const call of nodes.get(id)?.calls ?? []) {
      if (call.required === false || (call.probability ?? 1) < 1) continue;
      if (call.routes !== undefined && !call.routes.includes(traffic.route ?? "")) continue;
      const edge = edges.get(call.edgeId);
      if (edge === undefined || edge.policies.fallback !== undefined) continue;
      visit(edge.to);
    }
  };
  visit(traffic.target);
  return required;
}

/**
 * Static graph analysis: non-entry nodes that every traffic source depends on, with no fallback
 * on the way. Warning when the node also failed or saturated in this run, info otherwise.
 */
export function singlePointOfFailure(
  scenario: Scenario,
  result: SimulationResult,
  saturated: Map<string, Window[]>,
): Finding[] {
  if (scenario.traffic.length === 0) return [];
  const sets = scenario.traffic.map((t) => requiredNodes(scenario, t));
  const entries = new Set(scenario.traffic.map((t) => t.target));
  const end = result.series.buckets * result.series.bucketMs;
  const findings: Finding[] = [];
  for (const node of scenario.nodes) {
    if (entries.has(node.id) || !sets.every((s) => s.has(node.id))) continue;
    const failed = sum(result.series.nodes[node.id]?.failed ?? []);
    const evidence: Evidence[] = [
      {
        nodeId: node.id,
        fromMs: 0,
        toMs: end,
        metric: "requiredByTrafficSources",
        value: scenario.traffic.length,
      },
    ];
    if (failed > 0)
      evidence.push({ nodeId: node.id, fromMs: 0, toMs: end, metric: "failed", value: failed });
    findings.push({
      id: `single-point-of-failure:${node.id}`,
      rule: "single-point-of-failure",
      severity: failed > 0 || saturated.has(node.id) ? "warning" : "info",
      title: `Every request depends on ${node.name}`,
      summary:
        `All ${scenario.traffic.length} traffic source(s) need ${node.name} through required calls with no fallback, ` +
        `so its failure fails every request${failed > 0 ? `; it failed ${failed} responses in this run` : ""}.`,
      evidence,
    });
  }
  return findings;
}
