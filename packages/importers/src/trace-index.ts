import type { Span } from "./otlp";

/** Spans grouped for lookup: children by parent, and traces by id. */
export interface TraceIndex {
  spans: readonly Span[];
  children: ReadonlyMap<string, readonly Span[]>;
}

const key = (traceId: string, spanId: string): string => `${traceId}/${spanId}`;

export function indexSpans(spans: readonly Span[]): TraceIndex {
  const children = new Map<string, Span[]>();
  for (const s of spans) {
    if (s.parentSpanId === null) continue;
    const k = key(s.traceId, s.parentSpanId);
    const list = children.get(k);
    if (list === undefined) children.set(k, [s]);
    else list.push(s);
  }
  return { spans, children };
}

export function childrenOf(index: TraceIndex, parent: Span): readonly Span[] {
  return index.children.get(key(parent.traceId, parent.spanId)) ?? [];
}

/** When requests entered the system: the first and last trace-starting span, and how many. */
export function rootRange(
  spans: readonly Span[],
): { fromMs: number; toMs: number; requests: number } | null {
  const starts = spans.filter((s) => s.parentSpanId === null).map((s) => s.startMs);
  if (starts.length === 0) return null;
  return { fromMs: Math.min(...starts), toMs: Math.max(...starts), requests: starts.length };
}

/**
 * The spans of the traces that started in [fromMs, toMs). A trace starts when its first root span
 * does (the first span of any kind if no root was recorded). Open ends keep everything.
 */
export function spansInWindow(spans: readonly Span[], fromMs?: number, toMs?: number): Span[] {
  if (fromMs === undefined && toMs === undefined) return [...spans];
  const start = new Map<string, number>();
  const rootStart = new Map<string, number>();
  for (const s of spans) {
    start.set(s.traceId, Math.min(start.get(s.traceId) ?? s.startMs, s.startMs));
    if (s.parentSpanId === null)
      rootStart.set(s.traceId, Math.min(rootStart.get(s.traceId) ?? s.startMs, s.startMs));
  }
  return spans.filter((s) => {
    const t = rootStart.get(s.traceId) ?? start.get(s.traceId) ?? s.startMs;
    return (fromMs === undefined || t >= fromMs) && (toMs === undefined || t < toMs);
  });
}
