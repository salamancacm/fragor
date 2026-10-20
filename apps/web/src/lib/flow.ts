import type { BreakerState, Scenario, SimulationResult } from "@fragor/engine";

/** A link drawn on the stage: traffic into an entry node, or a scenario edge. */
export interface StageLink {
  id: string;
  kind: "traffic" | "edge";
  /** Node id, or `source:<target>` for the traffic source box of an entry node. */
  from: string;
  to: string;
  /** Short policy labels shown on the link (timeout, retries, breaker, bulkhead, fallback). */
  policies: string[];
  hasBreaker: boolean;
}

/** What crossed a link in one bucket, as counts. */
export interface LinkFlow {
  /** Requests that went over the wire (attempts minus those rejected before the network). */
  sent: number;
  /** Rejected without being served: 503 at an entry node, circuit open or bulkhead full on edges. */
  rejected: number;
  ok: number;
  degraded: number;
  /** Failed responses, excluding `rejected`. */
  failed: number;
  timeouts: number;
  /** Attempts per invocation (edges only; null when there were no invocations). */
  amplification: number | null;
  breaker: BreakerState | null;
}

export const sourceId = (target: string): string => `source:${target}`;

const at = (xs: readonly (number | null)[] | null | undefined, i: number): number => xs?.[i] ?? 0;

function policyLabels(p: Scenario["edges"][number]["policies"]): string[] {
  const out: string[] = [];
  if (p.timeout !== undefined) out.push(`timeout ${p.timeout.valueMs / 1000}s`);
  if (p.retry !== undefined) out.push(`${p.retry.maxRetries} retries`);
  if (p.circuitBreaker !== undefined) out.push("breaker");
  if (p.bulkhead !== undefined) out.push(`bulkhead ${p.bulkhead.value}`);
  if (p.fallback !== undefined) out.push("fallback");
  return out;
}

/** One traffic link per entry node (sources hitting the same node are merged), then every edge. */
export function stageLinks(s: Scenario): StageLink[] {
  const targets = [...new Set(s.traffic.map((t) => t.target))];
  return [
    ...targets.map((target) => ({
      id: `traffic:${target}`,
      kind: "traffic" as const,
      from: sourceId(target),
      to: target,
      policies: [],
      hasBreaker: false,
    })),
    ...s.edges.map((e) => ({
      id: e.id,
      kind: "edge" as const,
      from: e.from,
      to: e.to,
      policies: policyLabels(e.policies),
      hasBreaker: e.policies.circuitBreaker !== undefined,
    })),
  ];
}

/**
 * Flow over `link` in bucket `i`. Traffic links show the entry node's own counts: what arrived
 * there and how it answered (an entry node that is also called by other nodes mixes both).
 */
export function linkFlow(r: SimulationResult, link: StageLink, i: number): LinkFlow {
  if (link.kind === "traffic") {
    const n = r.series.nodes[link.to];
    const rejected = at(n?.rejected503, i);
    return {
      sent: Math.max(0, at(n?.arrivals, i) - rejected),
      rejected,
      ok: at(n?.success, i),
      degraded: at(n?.degraded, i),
      failed: Math.max(0, at(n?.failed, i) - rejected),
      timeouts: 0,
      amplification: null,
      breaker: null,
    };
  }
  const e = r.series.edges[link.id];
  const attempts = at(e?.attempts, i);
  const rejected = at(e?.circuitOpen, i) + at(e?.bulkheadFull, i);
  const invocations = at(e?.arrivals, i);
  return {
    sent: Math.max(0, attempts - rejected),
    rejected,
    ok: at(e?.success, i),
    degraded: at(e?.degraded, i),
    failed: at(e?.failed, i),
    timeouts: at(e?.timeouts, i),
    amplification: invocations === 0 ? null : attempts / invocations,
    breaker: e?.breakerState?.[i] ?? null,
  };
}
