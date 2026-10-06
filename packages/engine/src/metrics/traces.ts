import { hashUnit } from "../core/hash";
import type {
  FailureKind,
  Ms,
  RootOutcome,
  SampledTrace,
  TraceSpan,
  TraceSpanKind,
} from "../model/types";

export interface SpanIds {
  nodeId?: string;
  edgeId?: string;
  attempt?: number;
}

/** Mutable trace under construction. Dropped traces keep accepting calls as no-ops. */
export class TraceBuilder {
  dropped = false;
  private readonly spans: TraceSpan[] = [];

  constructor(
    readonly rootKey: string,
    readonly rank: number,
  ) {}

  open(kind: TraceSpanKind, parent: SpanRef | null, at: Ms, ids: SpanIds): SpanRef | null {
    if (this.dropped) return null;
    const span: TraceSpan = {
      spanId: `${this.rootKey}.${this.spans.length}`,
      parentSpanId: parent?.span.spanId ?? null,
      kind,
      nodeId: ids.nodeId ?? null,
      edgeId: ids.edgeId ?? null,
      startMs: at,
      endMs: null,
      outcome: "unfinished",
      failure: null,
      attempt: ids.attempt ?? null,
      orphaned: false,
      cancelled: false,
    };
    this.spans.push(span);
    return { trace: this, span };
  }

  toSpans(): TraceSpan[] {
    return this.spans.map((s) => ({ ...s }));
  }
}

export interface SpanRef {
  readonly trace: TraceBuilder;
  readonly span: TraceSpan;
}

export function closeSpan(
  ref: SpanRef | null,
  at: Ms,
  outcome: RootOutcome,
  failure: FailureKind | null,
): void {
  if (ref === null || ref.trace.dropped) return;
  ref.span.endMs = at;
  ref.span.outcome = outcome;
  ref.span.failure = failure;
}

/** Flags a span as orphaned or cancelled (no-op when the root is not sampled). */
export function flagSpan(ref: SpanRef | null, flag: "orphaned" | "cancelled"): void {
  if (ref === null || ref.trace.dropped) return;
  ref.span[flag] = true;
}

export function openChildSpan(
  parent: SpanRef | null,
  kind: TraceSpanKind,
  at: Ms,
  ids: SpanIds,
): SpanRef | null {
  if (parent === null) return null;
  return parent.trace.open(kind, parent, at, ids);
}

/**
 * Deterministic bottom-k sampling: keeps the `max` roots with the smallest
 * hash(seed, rootKey). The selection does not depend on arrival order or timing, so it is
 * stable across runs and roughly uniform over the whole simulation.
 */
export class TraceSampler {
  /** Kept traces sorted by rank ascending. */
  private kept: TraceBuilder[] = [];

  constructor(
    private readonly seed: number,
    private readonly max: number,
  ) {
    if (!Number.isInteger(max) || max < 0) {
      throw new Error(`maxTraces must be an integer >= 0, got ${max}`);
    }
  }

  /** Returns a builder if the root is (for now) in the sample, otherwise null. */
  consider(rootKey: string): TraceBuilder | null {
    if (this.max === 0) return null;
    const rank = hashUnit(`${this.seed}\u0000trace\u0000${rootKey}`);
    if (this.kept.length >= this.max) {
      const worst = this.kept[this.kept.length - 1] as TraceBuilder;
      if (rank >= worst.rank) return null;
      worst.dropped = true;
      this.kept.pop();
    }
    const builder = new TraceBuilder(rootKey, rank);
    let i = this.kept.length;
    while (i > 0 && (this.kept[i - 1] as TraceBuilder).rank > rank) i--;
    this.kept.splice(i, 0, builder);
    return builder;
  }
}

export interface TraceRootInfo {
  rootKey: string;
  trafficId: string;
  route: string | null;
  startMs: Ms;
  endMs: Ms | null;
  outcome: RootOutcome;
  failure: FailureKind | null;
}

export function buildTrace(builder: TraceBuilder, info: TraceRootInfo): SampledTrace {
  return {
    traceId: info.rootKey,
    rootId: info.rootKey,
    trafficId: info.trafficId,
    route: info.route,
    startMs: info.startMs,
    endMs: info.endMs,
    outcome: info.outcome,
    failure: info.failure,
    spans: builder.toSpans(),
  };
}
