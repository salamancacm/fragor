import type { FaultSpec, NodeSpec, Scenario } from "../model/types";
import { validateEdge, validateFault } from "./validate-parts";

/**
 * Structural checks the engine needs to run safely, with messages naming the offending field.
 * User-facing validation (Zod schemas, JSON Schema) lives in @fragor/scenarios (M3).
 */
export function validateScenario(s: Scenario): void {
  if (s.schemaVersion !== 1) {
    throw new Error(`unsupported schemaVersion ${String(s.schemaVersion)}`);
  }
  if (!Number.isFinite(s.seed)) throw new Error(`seed must be a finite number, got ${s.seed}`);
  requirePositive("durationMs", s.durationMs);
  if (s.metrics !== undefined) requirePositive("metrics.bucketMs", s.metrics.bucketMs);
  const o = s.options ?? {};
  if (o.drainMs !== undefined) requireNonNegative("options.drainMs", o.drainMs);
  if (o.defaultEdgeTimeoutMs !== undefined) {
    requirePositive("options.defaultEdgeTimeoutMs", o.defaultEdgeTimeoutMs);
  }
  unique("nodes", s.nodes);
  unique("edges", s.edges);
  unique("traffic", s.traffic);
  unique("faults", s.faults);
  const nodeIds = new Set(s.nodes.map((n) => n.id));
  const edges = new Map(s.edges.map((e) => [e.id, e]));
  for (const n of s.nodes) validateNode(n);
  for (const e of s.edges) validateEdge(e, nodeIds);
  for (const n of s.nodes) validateCalls(n, edges);
  for (const t of s.traffic) {
    if (!nodeIds.has(t.target)) {
      throw new Error(`traffic[${t.id}].target references unknown node "${t.target}"`);
    }
  }
  const ids = {
    nodes: nodeIds,
    edges: new Set(edges.keys()),
    traffic: new Set(s.traffic.map((t) => t.id)),
  };
  for (const f of s.faults) validateFault(f as FaultSpec, ids);
  rejectCallCycles(s);
}

function validateNode(n: NodeSpec): void {
  if (!Number.isInteger(n.workers) || n.workers < 1) {
    throw new Error(`nodes[${n.id}].workers must be an integer >= 1, got ${n.workers}`);
  }
  if (n.queueLimit !== null && (!Number.isInteger(n.queueLimit) || n.queueLimit < 0)) {
    throw new Error(`nodes[${n.id}].queueLimit must be null or an integer >= 0`);
  }
  requireFraction(`nodes[${n.id}].errorRate`, n.errorRate);
  if (n.kind !== "service" && n.kind !== "external-api") {
    throw new Error(`nodes[${n.id}].kind "${String(n.kind)}" is not supported`);
  }
  if (n.workerModel !== "blocking" && n.workerModel !== "async") {
    throw new Error(`nodes[${n.id}].workerModel must be "blocking" or "async"`);
  }
}

function validateCalls(n: NodeSpec, edges: Map<string, Scenario["edges"][number]>): void {
  for (const [i, c] of n.calls.entries()) {
    const path = `nodes[${n.id}].calls[${i}]`;
    const edge = edges.get(c.edgeId);
    if (edge === undefined) throw new Error(`${path}.edgeId references unknown edge "${c.edgeId}"`);
    if (edge.from !== n.id) {
      throw new Error(`${path}: edge "${c.edgeId}" starts at "${edge.from}", not at "${n.id}"`);
    }
    if (c.probability !== undefined) requireFraction(`${path}.probability`, c.probability);
  }
}

/** Calls must form a DAG, otherwise a request could recurse forever. */
function rejectCallCycles(s: Scenario): void {
  const edgeTo = new Map(s.edges.map((e) => [e.id, e.to]));
  const next = new Map(s.nodes.map((n) => [n.id, n.calls.map((c) => edgeTo.get(c.edgeId) ?? "")]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      throw new Error(`call cycle detected: ${[...path, id].join(" -> ")}`);
    }
    state.set(id, "visiting");
    for (const to of next.get(id) ?? []) visit(to, [...path, id]);
    state.set(id, "done");
  };
  for (const n of s.nodes) visit(n.id, []);
}

export function requirePositive(name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be > 0, got ${v}`);
}

export function requireNonNegative(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) throw new Error(`${name} must be >= 0, got ${v}`);
}

export function requireFraction(name: string, v: number): void {
  if (!(v >= 0 && v <= 1)) throw new Error(`${name} must be in [0, 1], got ${v}`);
}

export function requireInteger(name: string, v: number, min: number): void {
  if (!Number.isInteger(v) || v < min) {
    throw new Error(`${name} must be an integer >= ${min}, got ${v}`);
  }
}

function unique(collection: string, items: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) throw new Error(`duplicate id "${id}" in ${collection}`);
    seen.add(id);
  }
}
