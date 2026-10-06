import { Histogram } from "../core/histogram";
import type { SeriesBuilder } from "../metrics/series-builder";
import { buildTrace, closeSpan, type SpanRef, type TraceSampler } from "../metrics/traces";
import {
  FAILURE_KINDS,
  type FailureKind,
  type Ms,
  type RootOutcome,
  type SampledTrace,
  type TrafficSummary,
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

interface Tally {
  roots: number;
  success: number;
  degraded: number;
  failed: number;
  readonly latency: Histogram;
}

function newTally(): Tally {
  return { roots: 0, success: 0, degraded: 0, failed: 0, latency: new Histogram() };
}

/** Creates roots, classifies their final outcome and records end-to-end latency. */
export class RootTracker {
  private seq = 0;
  private readonly all = newTally();
  private readonly perTraffic = new Map<string, Tally>();
  private readonly reasons = new Map<FailureKind, number>(FAILURE_KINDS.map((k) => [k, 0]));
  private readonly sampled: RootRequest[] = [];

  constructor(
    private readonly series: SeriesBuilder,
    private readonly sampler: TraceSampler,
    trafficIds: readonly string[],
  ) {
    for (const id of trafficIds) this.perTraffic.set(id, newTally());
  }

  create(trafficId: string, route: string | null, nowMs: Ms): RootRequest {
    const seq = this.seq++;
    const key = `r${seq}`;
    const builder = this.sampler.consider(key);
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
    this.all.roots++;
    this.tally(trafficId).roots++;
    this.series.inc("arrivals");
    return root;
  }

  /** `failure` is the root cause (see JobResult.cause); null unless outcome is "failed". */
  complete(
    root: RootRequest,
    nowMs: Ms,
    outcome: CompletedOutcome,
    failure: FailureKind | null,
  ): void {
    if (root.outcome !== "unfinished") throw new Error(`root ${root.key} completed twice`);
    root.outcome = outcome;
    root.failure = outcome === "failed" ? failure : null;
    root.endMs = nowMs;
    const latency = nowMs - root.createdAtMs;
    for (const t of [this.all, this.tally(root.trafficId)]) {
      t[outcome]++;
      t.latency.record(latency);
    }
    this.series.inc(outcome);
    this.series.recordLatency(latency);
    if (root.failure !== null) {
      this.reasons.set(root.failure, (this.reasons.get(root.failure) ?? 0) + 1);
    }
    closeSpan(root.span, nowMs, outcome, root.failure);
  }

  get created(): number {
    return this.all.roots;
  }

  get completed(): number {
    return this.all.success + this.all.degraded + this.all.failed;
  }

  outcomeCounts(): { success: number; degraded: number; failed: number } {
    return { success: this.all.success, degraded: this.all.degraded, failed: this.all.failed };
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
    const [p50, p95, p99] = this.all.latency.quantiles([0.5, 0.95, 0.99]);
    return { avg: this.all.latency.mean(), p50: p50 ?? null, p95: p95 ?? null, p99: p99 ?? null };
  }

  byTraffic(): Record<string, TrafficSummary> {
    const out: Record<string, TrafficSummary> = {};
    for (const [id, t] of this.perTraffic) {
      const [p50, p99] = t.latency.quantiles([0.5, 0.99]);
      out[id] = {
        roots: t.roots,
        success: t.success,
        degraded: t.degraded,
        failed: t.failed,
        unfinished: t.roots - t.success - t.degraded - t.failed,
        p50Ms: p50 ?? null,
        p99Ms: p99 ?? null,
      };
    }
    return out;
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

  private tally(trafficId: string): Tally {
    const t = this.perTraffic.get(trafficId);
    if (t === undefined) throw new Error(`unknown traffic source "${trafficId}"`);
    return t;
  }
}
