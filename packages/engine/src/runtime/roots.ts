import { Histogram } from "../core/histogram";
import type { SeriesBuilder } from "../metrics/series-builder";
import { buildTrace, closeSpan, type SpanRef, type TraceSampler } from "../metrics/traces";
import {
  FAILURE_KINDS,
  type FailureKind,
  type Ms,
  type RootOutcome,
  type SampledTrace,
} from "../model/types";

/** A request created by a traffic source. Descendant calls inherit its id and route. */
export interface RootRequest {
  readonly seq: number;
  readonly key: string;
  readonly trafficId: string;
  readonly route: string | null;
  readonly createdAtMs: Ms;
  outcome: RootOutcome;
  failure: FailureKind | null;
  endMs: Ms | null;
  readonly span: SpanRef | null;
}

export type CompletedOutcome = Exclude<RootOutcome, "unfinished">;

/** Creates roots, classifies their final outcome and records end-to-end latency. */
export class RootTracker {
  private seq = 0;
  private completedCount = 0;
  private readonly latency = new Histogram();
  private readonly reasons = new Map<FailureKind, number>(FAILURE_KINDS.map((k) => [k, 0]));
  private readonly counts = { success: 0, degraded: 0, failed: 0 };
  private readonly sampled: RootRequest[] = [];

  constructor(
    private readonly series: SeriesBuilder,
    private readonly sampler: TraceSampler,
  ) {}

  create(trafficId: string, route: string | null, nowMs: Ms): RootRequest {
    const seq = this.seq++;
    const key = `r${seq}`;
    const builder = this.sampler.consider(key, seq);
    const span = builder?.open("root", null, nowMs, {}) ?? null;
    const root: RootRequest = {
      seq,
      key,
      trafficId,
      route,
      createdAtMs: nowMs,
      outcome: "unfinished",
      failure: null,
      endMs: null,
      span,
    };
    if (builder !== null) this.sampled.push(root);
    this.series.inc("arrivals");
    return root;
  }

  complete(
    root: RootRequest,
    nowMs: Ms,
    outcome: CompletedOutcome,
    failure: FailureKind | null,
  ): void {
    if (root.outcome !== "unfinished") {
      throw new Error(`root ${root.key} completed twice`);
    }
    root.outcome = outcome;
    root.failure = outcome === "failed" ? failure : null;
    root.endMs = nowMs;
    this.completedCount++;
    this.counts[outcome]++;
    this.series.inc(outcome);
    if (root.failure !== null) {
      this.reasons.set(root.failure, (this.reasons.get(root.failure) ?? 0) + 1);
    }
    const latency = nowMs - root.createdAtMs;
    this.latency.record(latency);
    this.series.recordLatency(latency);
    closeSpan(root.span, nowMs, outcome, root.failure);
  }

  get created(): number {
    return this.seq;
  }

  get completed(): number {
    return this.completedCount;
  }

  outcomeCounts(): { success: number; degraded: number; failed: number } {
    return { ...this.counts };
  }

  failureReasons(): Record<FailureKind, number> {
    const out = {} as Record<FailureKind, number>;
    for (const k of FAILURE_KINDS) out[k] = this.reasons.get(k) ?? 0;
    return out;
  }

  latencyStats(): {
    avg: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
  } {
    const [p50, p95, p99] = this.latency.quantiles([0.5, 0.95, 0.99]);
    return { avg: this.latency.mean(), p50: p50 ?? null, p95: p95 ?? null, p99: p99 ?? null };
  }

  traces(): SampledTrace[] {
    return this.sampled
      .filter((r) => r.span !== null && !r.span.trace.dropped)
      .map((r) =>
        buildTrace((r.span as SpanRef).trace, {
          rootKey: r.key,
          trafficId: r.trafficId,
          route: r.route,
          startMs: r.createdAtMs,
          endMs: r.endMs,
          outcome: r.outcome,
          failure: r.failure,
        }),
      );
  }
}
