import type { Scenario } from "@fragor/engine";

export interface Position {
  x: number;
  y: number;
}

export const COLUMN_WIDTH = 220;
export const ROW_HEIGHT = 110;

/**
 * Layered layout for a call DAG: entry nodes (traffic targets) in column 0, each node one column
 * right of its deepest caller; rows by declaration order, centered per column. Deterministic.
 */
export function layoutGraph(s: Scenario): Record<string, Position> {
  const callers = new Map<string, string[]>(s.nodes.map((n) => [n.id, []]));
  for (const e of s.edges) callers.get(e.to)?.push(e.from);
  const layer = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0; // defensive: scenarios are validated acyclic
    seen.add(id);
    const ups = callers.get(id) ?? [];
    const d = ups.length === 0 ? 0 : 1 + Math.max(...ups.map((u) => depth(u, seen)));
    layer.set(id, d);
    return d;
  };
  for (const n of s.nodes) depth(n.id, new Set());
  const columns = new Map<number, string[]>();
  for (const n of s.nodes) {
    const d = layer.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n.id]);
  }
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));
  const out: Record<string, Position> = {};
  for (const [d, ids] of columns) {
    const offset = ((tallest - ids.length) * ROW_HEIGHT) / 2;
    ids.forEach((id, row) => {
      out[id] = { x: d * COLUMN_WIDTH, y: offset + row * ROW_HEIGHT };
    });
  }
  return out;
}
