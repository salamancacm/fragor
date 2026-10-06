import type { CallSpec, EdgeSpec, NodeSpec, Scenario } from "@fragor/engine";
import { z } from "zod";
import { callSchema, edgeSchema, nodeSchema } from "./schema";
import { parseScenario } from "./validate";

/**
 * A path into a scenario. Items of `nodes`, `edges`, `traffic` and `faults` are addressed by
 * id; other arrays (calls, components, routes...) by index. As a string, segments are separated
 * by dots: `edges.order-payment.policies.timeout.valueMs`.
 */
export type PatchPath = string | readonly string[];

export type PatchOp =
  | { op: "set"; path: PatchPath; value: unknown }
  | { op: "unset"; path: PatchPath }
  | { op: "add-node"; node: NodeSpec }
  | { op: "remove-node"; nodeId: string }
  | { op: "add-edge"; edge: EdgeSpec; call?: Omit<CallSpec, "edgeId"> }
  | { op: "remove-edge"; edgeId: string };

export class PatchError extends Error {
  constructor(
    readonly opIndex: number,
    message: string,
  ) {
    super(`patch op #${opIndex}: ${message}`);
    this.name = "PatchError";
  }
}

const pathSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  .describe(
    "Dotted path or list of segments; nodes/edges/traffic/faults items are addressed by id.",
  );

/** Schema of one patch operation, for validating patches that come from outside (CLI, UI, AI). */
export const patchOpSchema = z
  .discriminatedUnion("op", [
    z
      .strictObject({ op: z.literal("set"), path: pathSchema, value: z.unknown() })
      .describe("Set a value."),
    z
      .strictObject({ op: z.literal("unset"), path: pathSchema })
      .describe("Remove an optional field, e.g. a policy."),
    z.strictObject({ op: z.literal("add-node"), node: nodeSchema }).describe("Add a node."),
    z
      .strictObject({ op: z.literal("remove-node"), nodeId: z.string() })
      .describe("Remove a node, its edges, the calls to them and the faults on them."),
    z
      .strictObject({
        op: z.literal("add-edge"),
        edge: edgeSchema,
        call: callSchema.omit({ edgeId: true }).exactOptional(),
      })
      .describe("Add an edge; with `call`, also append a call to it on the `from` node."),
    z
      .strictObject({ op: z.literal("remove-edge"), edgeId: z.string() })
      .describe("Remove an edge, the calls to it and the faults on it."),
  ])
  .describe("A typed scenario edit.");

/** Validates unknown input as a list of patch operations. */
export function parsePatch(input: unknown): PatchOp[] {
  return z.array(patchOpSchema).parse(input) as PatchOp[];
}

/**
 * Applies `ops` in order to a copy of `scenario` and validates the result with parseScenario.
 * Pure: the input is never mutated. Throws PatchError for an op that cannot apply and
 * ScenarioValidationError if the resulting scenario is invalid.
 */
export function applyPatch(scenario: Scenario, ops: readonly PatchOp[]): Scenario {
  const draft = cloneJson(scenario);
  for (const [i, op] of ops.entries()) applyOne(draft, op, i);
  return parseScenario(draft);
}

/** Scenarios are plain JSON, so a JSON round trip is a faithful deep copy. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const BY_ID = new Set(["nodes", "edges", "traffic", "faults"]);

export function splitPath(path: PatchPath): string[] {
  const segments = typeof path === "string" ? path.split(".") : [...path];
  if (segments.length === 0 || segments.some((s) => s === "")) {
    throw new Error(`invalid path "${String(path)}"`);
  }
  return segments;
}

type Container = Record<string, unknown> | unknown[];

function isContainer(v: unknown): v is Container {
  return typeof v === "object" && v !== null;
}

/** Resolves the container holding the last segment, creating missing objects when `create`. */
function resolveParent(
  root: Scenario,
  segments: string[],
  i: number,
  create: boolean,
): [Container, string] {
  let cursor: unknown = root;
  let parentKey = "";
  for (const seg of segments.slice(0, -1)) {
    const next = child(cursor, seg, parentKey, i);
    if (next === undefined) {
      if (!create || Array.isArray(cursor) || !isContainer(cursor)) {
        throw new PatchError(i, `path segment "${seg}" not found`);
      }
      const created: Record<string, unknown> = {};
      (cursor as Record<string, unknown>)[seg] = created;
      cursor = created;
    } else {
      cursor = next;
    }
    parentKey = seg;
  }
  if (!isContainer(cursor)) throw new PatchError(i, "path does not lead to an object or array");
  return [cursor, segments.at(-1) as string];
}

function child(cursor: unknown, seg: string, parentKey: string, i: number): unknown {
  if (Array.isArray(cursor)) return cursor[arrayIndex(cursor, seg, parentKey, i)];
  if (isContainer(cursor)) return (cursor as Record<string, unknown>)[seg];
  throw new PatchError(i, `cannot descend into a primitive at "${seg}"`);
}

function arrayIndex(arr: unknown[], seg: string, parentKey: string, i: number): number {
  if (BY_ID.has(parentKey)) {
    const idx = arr.findIndex((x) => isContainer(x) && (x as { id?: unknown }).id === seg);
    if (idx < 0) throw new PatchError(i, `no item with id "${seg}" in ${parentKey}`);
    return idx;
  }
  const n = Number(seg);
  if (!Number.isInteger(n) || n < 0 || n > arr.length) {
    throw new PatchError(i, `"${seg}" is not a valid index of ${parentKey || "array"}`);
  }
  return n;
}

function applyOne(s: Scenario, op: PatchOp, i: number): void {
  switch (op.op) {
    case "set": {
      if (op.value === undefined) throw new PatchError(i, "set needs a value; use unset to remove");
      const segments = splitPath(op.path);
      const [parent, last] = resolveParent(s, segments, i, true);
      const parentKey = segments.at(-2) ?? "";
      if (Array.isArray(parent))
        parent[arrayIndex(parent, last, parentKey, i)] = cloneJson(op.value);
      else parent[last] = cloneJson(op.value);
      return;
    }
    case "unset": {
      const segments = splitPath(op.path);
      const [parent, last] = resolveParent(s, segments, i, false);
      const parentKey = segments.at(-2) ?? "";
      if (Array.isArray(parent)) parent.splice(arrayIndex(parent, last, parentKey, i), 1);
      else if (last in parent) delete parent[last];
      else throw new PatchError(i, `nothing to unset at "${segments.join(".")}"`);
      return;
    }
    case "add-node":
      if (s.nodes.some((n) => n.id === op.node.id))
        throw new PatchError(i, `node "${op.node.id}" already exists`);
      s.nodes.push(cloneJson(op.node));
      return;
    case "remove-node":
      removeNode(s, op.nodeId, i);
      return;
    case "add-edge": {
      if (s.edges.some((e) => e.id === op.edge.id))
        throw new PatchError(i, `edge "${op.edge.id}" already exists`);
      s.edges.push(cloneJson(op.edge));
      if (op.call !== undefined) {
        const from = s.nodes.find((n) => n.id === op.edge.from);
        if (from === undefined) throw new PatchError(i, `node "${op.edge.from}" not found`);
        from.calls.push({ ...cloneJson(op.call), edgeId: op.edge.id });
      }
      return;
    }
    case "remove-edge":
      if (!s.edges.some((e) => e.id === op.edgeId))
        throw new PatchError(i, `edge "${op.edgeId}" not found`);
      removeEdges(s, new Set([op.edgeId]));
      return;
  }
}

function removeNode(s: Scenario, nodeId: string, i: number): void {
  if (!s.nodes.some((n) => n.id === nodeId)) throw new PatchError(i, `node "${nodeId}" not found`);
  const feeding = s.traffic.filter((t) => t.target === nodeId).map((t) => t.id);
  if (feeding.length > 0) {
    throw new PatchError(
      i,
      `node "${nodeId}" receives traffic (${feeding.join(", ")}); remove or retarget it first`,
    );
  }
  removeEdges(
    s,
    new Set(s.edges.filter((e) => e.from === nodeId || e.to === nodeId).map((e) => e.id)),
  );
  s.nodes = s.nodes.filter((n) => n.id !== nodeId);
  s.faults = s.faults.filter((f) => !("node" in f.target && f.target.node === nodeId));
}

function removeEdges(s: Scenario, ids: ReadonlySet<string>): void {
  s.edges = s.edges.filter((e) => !ids.has(e.id));
  for (const n of s.nodes) n.calls = n.calls.filter((c) => !ids.has(c.edgeId));
  s.faults = s.faults.filter((f) => !("edge" in f.target && ids.has(f.target.edge)));
}
