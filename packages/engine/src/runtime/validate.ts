import type { NodeSpec, Scenario } from "../model/types";

/**
 * Structural checks the engine needs to run safely. Full user-facing validation (Zod,
 * readable messages, cycle detection) lives in @fragor/scenarios (M3).
 */
export function validateScenario(s: Scenario): void {
  if (s.schemaVersion !== 1)
    throw new Error(`unsupported schemaVersion ${String(s.schemaVersion)}`);
  if (!Number.isFinite(s.seed)) throw new Error(`seed must be a finite number, got ${s.seed}`);
  requirePositive("durationMs", s.durationMs);
  if (s.metrics !== undefined) requirePositive("metrics.bucketMs", s.metrics.bucketMs);
  const drain = s.options?.drainMs;
  if (drain !== undefined && (!Number.isFinite(drain) || drain < 0)) {
    throw new Error(`options.drainMs must be >= 0, got ${drain}`);
  }
  unique("nodes", s.nodes);
  unique("edges", s.edges);
  unique("traffic", s.traffic);
  unique("faults", s.faults);
  for (const n of s.nodes) validateNode(n);
  const nodeIds = new Set(s.nodes.map((n) => n.id));
  for (const t of s.traffic) {
    if (!nodeIds.has(t.target)) {
      throw new Error(`traffic[${t.id}].target references unknown node "${t.target}"`);
    }
  }
  rejectUnimplemented(s);
}

/** Features specified in the brief but scheduled for M2. Fail loudly instead of ignoring. */
function rejectUnimplemented(s: Scenario): void {
  if (s.edges.length > 0) throw new Error("not implemented: edges and calls between nodes (M2)");
  if (s.faults.length > 0) throw new Error("not implemented: faults (M2)");
  for (const n of s.nodes) {
    if (n.calls.length > 0) throw new Error(`not implemented: nodes[${n.id}].calls (M2)`);
  }
  if (s.options?.cancelOnTimeout === true) {
    throw new Error("not implemented: options.cancelOnTimeout (M2)");
  }
}

function validateNode(n: NodeSpec): void {
  if (!Number.isInteger(n.workers) || n.workers < 1) {
    throw new Error(`nodes[${n.id}].workers must be an integer >= 1, got ${n.workers}`);
  }
  if (n.queueLimit !== null && (!Number.isInteger(n.queueLimit) || n.queueLimit < 0)) {
    throw new Error(`nodes[${n.id}].queueLimit must be null or an integer >= 0`);
  }
  if (!(n.errorRate >= 0 && n.errorRate <= 1)) {
    throw new Error(`nodes[${n.id}].errorRate must be in [0, 1], got ${n.errorRate}`);
  }
  if (n.kind !== "service" && n.kind !== "external-api") {
    throw new Error(`nodes[${n.id}].kind "${String(n.kind)}" is not supported`);
  }
}

function requirePositive(name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be > 0, got ${v}`);
}

function unique(collection: string, items: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) throw new Error(`duplicate id "${id}" in ${collection}`);
    seen.add(id);
  }
}
