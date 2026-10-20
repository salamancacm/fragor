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

/**
 * A link's center line, from the caller's right side (p0) to the callee's left side (p3): an S curve
 * up to `bend`, then flat into the callee, so labels sit on a level stretch. Level links are flat.
 */
export interface LinkGeometry {
  link: StageLink;
  p0: Point;
  bend: Point;
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
export const COL_GAP = 170;
/** Share of a link's width taken by the S curve when caller and callee are on different rows. */
const CURVE_SHARE = 0.42;
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
    const bend = p0.y === p3.y ? p0 : { x: p0.x + (p3.x - p0.x) * CURVE_SHARE, y: p3.y };
    return [{ link, p0, bend, p3 }];
  });
  const bottom = Math.max(...Object.values(boxes).map((b) => b.y + b.h));
  return { width: colX(maxCol) + NODE_W + PAD_X, height: bottom + PAD_BOTTOM, boxes, links };
}

/** Share of the link's parameter range taken by the curve. */
function curveShare(g: LinkGeometry): number {
  const span = g.p3.x - g.p0.x;
  return span <= 0 ? 0 : (g.bend.x - g.p0.x) / span;
}

/** Point at parameter `t` in [0, 1] along the link, shifted vertically by `offset`. */
export function pointOn(g: LinkGeometry, t: number, offset = 0): Point {
  const share = curveShare(g);
  if (t >= share) {
    const v = share >= 1 ? 1 : (t - share) / (1 - share);
    return {
      x: g.bend.x + (g.p3.x - g.bend.x) * v,
      y: g.bend.y + (g.p3.y - g.bend.y) * v + offset,
    };
  }
  const u = t / share;
  const h = (g.bend.x - g.p0.x) / 2;
  const w = 1 - u;
  const a = w * w * w;
  const b = 3 * w * w * u;
  const c = 3 * w * u * u;
  const d = u * u * u;
  return {
    x: a * g.p0.x + b * (g.p0.x + h) + c * (g.bend.x - h) + d * g.bend.x,
    y: (a + b) * g.p0.y + (c + d) * g.bend.y + offset,
  };
}

/** Parameter of the middle of the level stretch, where labels and the breaker gate go. */
export function labelParam(g: LinkGeometry): number {
  return (1 + curveShare(g)) / 2;
}

export function labelAnchor(g: LinkGeometry): Point {
  return pointOn(g, labelParam(g));
}

/** SVG path of the link shifted by `offset`. */
export function lanePath(g: LinkGeometry, offset: number): string {
  const p = (q: Point) => `${q.x},${q.y + offset}`;
  if (g.bend === g.p0) return `M${p(g.p0)} L${p(g.p3)}`;
  const h = (g.bend.x - g.p0.x) / 2;
  return `M${p(g.p0)} C${p({ x: g.p0.x + h, y: g.p0.y })} ${p({ x: g.bend.x - h, y: g.bend.y })} ${p(g.bend)} L${p(g.p3)}`;
}
