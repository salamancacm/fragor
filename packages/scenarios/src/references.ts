import type { Dist, FaultSpec, Scenario } from "@fragor/engine";

/** A problem found in a scenario. `path` is a list of keys; array items of id'd collections use their index. */
export interface RawIssue {
  path: (string | number)[];
  message: string;
}

const EFFECTS_BY_TARGET = {
  node: ["latency-add", "latency-multiply", "error-rate", "outage", "capacity"],
  edge: ["latency-add", "latency-multiply", "packet-loss", "outage"],
  traffic: ["traffic-multiply"],
} as const;

/**
 * Checks Zod cannot express field by field: unique ids, references between nodes, edges, calls,
 * traffic and faults, call cycles, and relations between numbers (maxMs >= minMs, ...).
 */
export function checkReferences(s: Scenario): RawIssue[] {
  const issues: RawIssue[] = [];
  const add = (path: (string | number)[], message: string): void => {
    issues.push({ path, message });
  };
  for (const key of ["nodes", "edges", "traffic", "faults"] as const) {
    const seen = new Set<string>();
    s[key].forEach((item, i) => {
      if (seen.has(item.id)) add([key, i, "id"], `duplicate id "${item.id}"`);
      seen.add(item.id);
    });
  }
  const nodes = new Set(s.nodes.map((n) => n.id));
  const edges = new Map(s.edges.map((e) => [e.id, e]));
  const traffic = new Set(s.traffic.map((t) => t.id));

  s.nodes.forEach((n, i) => {
    checkDist(n.serviceTime, ["nodes", i, "serviceTime"], add);
    n.calls.forEach((c, j) => {
      const edge = edges.get(c.edgeId);
      if (edge === undefined) add(["nodes", i, "calls", j, "edgeId"], `unknown edge "${c.edgeId}"`);
      else if (edge.from !== n.id) {
        add(
          ["nodes", i, "calls", j, "edgeId"],
          `edge "${c.edgeId}" starts at "${edge.from}", not at "${n.id}"`,
        );
      }
    });
  });
  s.edges.forEach((e, i) => {
    if (!nodes.has(e.from)) add(["edges", i, "from"], `unknown node "${e.from}"`);
    if (!nodes.has(e.to)) add(["edges", i, "to"], `unknown node "${e.to}"`);
    checkDist(e.latency, ["edges", i, "latency"], add);
    const r = e.policies.retry;
    if (r?.backoffFactor !== undefined) {
      const max = r.maxDelayMs ?? 60_000;
      if (max > 0 && r.delayMs >= max) {
        add(
          ["edges", i, "policies", "retry", "delayMs"],
          `must be < maxDelayMs (${max}) when backoffFactor is set`,
        );
      }
    }
    const fallbackLatency = e.policies.fallback?.latency;
    if (fallbackLatency !== undefined)
      checkDist(fallbackLatency, ["edges", i, "policies", "fallback", "latency"], add);
  });
  s.traffic.forEach((t, i) => {
    if (!nodes.has(t.target)) add(["traffic", i, "target"], `unknown node "${t.target}"`);
    if (t.startMs !== undefined && t.endMs !== undefined && t.endMs < t.startMs) {
      add(["traffic", i, "endMs"], "must be >= startMs");
    }
  });
  for (const [i, f] of s.faults.entries())
    checkFault(f, i, { nodes, edges: new Set(edges.keys()), traffic }, add);
  const cycle = findCallCycle(s);
  if (cycle !== null) add(["nodes"], `call cycle: ${cycle.join(" -> ")}`);
  return issues;
}

function checkFault(
  f: FaultSpec,
  i: number,
  ids: { nodes: Set<string>; edges: Set<string>; traffic: Set<string> },
  add: (path: (string | number)[], message: string) => void,
): void {
  const t = f.target;
  const [kind, target] =
    "node" in t
      ? (["node", t.node] as const)
      : "edge" in t
        ? (["edge", t.edge] as const)
        : (["traffic", t.traffic] as const);
  const known = kind === "node" ? ids.nodes : kind === "edge" ? ids.edges : ids.traffic;
  if (!known.has(target)) add(["faults", i, "target", kind], `unknown ${kind} "${target}"`);
  const allowed: readonly string[] = EFFECTS_BY_TARGET[kind];
  if (!allowed.includes(f.effect.type)) {
    add(
      ["faults", i, "effect", "type"],
      `"${f.effect.type}" is not allowed for target kind "${kind}"; allowed: ${allowed.join(", ")}`,
    );
  }
  if (f.effect.type === "latency-add") checkDist(f.effect.add, ["faults", i, "effect", "add"], add);
}

function checkDist(
  d: Dist,
  path: (string | number)[],
  add: (p: (string | number)[], m: string) => void,
): void {
  if (d.type === "uniform" && d.maxMs < d.minMs)
    add([...path, "maxMs"], `must be >= minMs (${d.minMs})`);
  if (d.type === "lognormal" && d.p99Ms < d.p50Ms)
    add([...path, "p99Ms"], `must be >= p50Ms (${d.p50Ms})`);
  if (d.type === "mixture") {
    for (const [i, c] of d.components.entries()) {
      checkDist(c.dist, [...path, "components", i, "dist"], add);
    }
  }
}

/** Returns a cycle of node ids if the calls graph has one, else null. */
export function findCallCycle(s: Scenario): string[] | null {
  const edgeTo = new Map(s.edges.map((e) => [e.id, e.to]));
  const next = new Map(s.nodes.map((n) => [n.id, n.calls.map((c) => edgeTo.get(c.edgeId))]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    for (const to of next.get(id) ?? []) {
      if (to === undefined) continue;
      const found = visit(to, [...path, id]);
      if (found !== null) return found;
    }
    state.set(id, "done");
    return null;
  };
  for (const n of s.nodes) {
    const found = visit(n.id, []);
    if (found !== null) return found;
  }
  return null;
}
