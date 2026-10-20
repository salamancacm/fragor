import type { Scenario } from "@fragor/engine";
import { type StageLink, sourceId, stageLinks } from "./flow";
import { COLUMN_WIDTH, layoutGraph, ROW_HEIGHT } from "./graph-layout";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A link's center curve: a cubic Bézier from the caller's right side to the callee's left side. */
export interface LinkGeometry {
  link: StageLink;
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

export interface StageLayout {
  width: number;
  height: number;
  /** Node boxes by node id, plus traffic source boxes by `source:<target>`. */
  boxes: Record<string, Box>;
  links: LinkGeometry[];
}

export const NODE_W = 200;
export const NODE_H = 172;
export const SOURCE_W = 116;
export const SOURCE_H = 96;
/** Room between columns for the link labels. */
export const COL_GAP = 132;
const ROW_GAP = 56;
const PAD_X = 16;
/** Room above the first row for fault badges. */
const PAD_TOP = 48;
const PAD_BOTTOM = 24;
/** Vertical offset of the request (up) and response (down) lanes from the center curve. */
export const LANE = 12;

/** Lays the scenario out in columns: traffic sources, then each call depth (deterministic). */
export function stageLayout(s: Scenario): StageLayout {
  const grid = layoutGraph(s);
  const rowStep = NODE_H + ROW_GAP;
  const colX = (col: number) => PAD_X + SOURCE_W + COL_GAP + col * (NODE_W + COL_GAP);
  const boxes: Record<string, Box> = {};
  let maxCol = 0;
  for (const n of s.nodes) {
    const g = grid[n.id] ?? { x: 0, y: 0 };
    const col = Math.round(g.x / COLUMN_WIDTH);
    maxCol = Math.max(maxCol, col);
    boxes[n.id] = { x: colX(col), y: PAD_TOP + (g.y / ROW_HEIGHT) * rowStep, w: NODE_W, h: NODE_H };
  }
  for (const target of new Set(s.traffic.map((t) => t.target))) {
    const b = boxes[target];
    if (b === undefined) continue;
    boxes[sourceId(target)] = {
      x: PAD_X,
      y: b.y + (NODE_H - SOURCE_H) / 2,
      w: SOURCE_W,
      h: SOURCE_H,
    };
  }
  const links = stageLinks(s).flatMap((link) => {
    const a = boxes[link.from];
    const b = boxes[link.to];
    if (a === undefined || b === undefined) return [];
    const p0 = { x: a.x + a.w, y: a.y + a.h / 2 };
    const p3 = { x: b.x, y: b.y + b.h / 2 };
    const dx = (p3.x - p0.x) / 2;
    return [{ link, p0, p1: { x: p0.x + dx, y: p0.y }, p2: { x: p3.x - dx, y: p3.y }, p3 }];
  });
  const bottom = Math.max(...Object.values(boxes).map((b) => b.y + b.h));
  return { width: colX(maxCol) + NODE_W + PAD_X, height: bottom + PAD_BOTTOM, boxes, links };
}

/** Point at parameter `t` in [0, 1] of the link's curve, shifted vertically by `offset`. */
export function pointOn(g: LinkGeometry, t: number, offset = 0): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * g.p0.x + b * g.p1.x + c * g.p2.x + d * g.p3.x,
    y: a * g.p0.y + b * g.p1.y + c * g.p2.y + d * g.p3.y + offset,
  };
}

/** SVG path of the curve shifted by `offset`. */
export function lanePath(g: LinkGeometry, offset: number): string {
  const p = (q: Point) => `${q.x},${q.y + offset}`;
  return `M${p(g.p0)} C${p(g.p1)} ${p(g.p2)} ${p(g.p3)}`;
}
