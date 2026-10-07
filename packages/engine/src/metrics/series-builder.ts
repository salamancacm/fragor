import { Histogram } from "../core/histogram";
import type { BreakerState, Ms, Series } from "../model/types";

export type CounterField =
  | "arrivals"
  | "success"
  | "degraded"
  | "failed"
  | "retries"
  | "timeouts"
  | "rejected503"
  | "orphanedResponses"
  | "orphanedWork"
  | "attempts"
  | "circuitOpen"
  | "bulkheadFull"
  | "fallbacks"
  | "timeoutsDelayed"
  | "timeoutsLost";

const COUNTER_FIELDS: readonly CounterField[] = [
  "arrivals",
  "success",
  "degraded",
  "failed",
  "retries",
  "timeouts",
  "rejected503",
  "orphanedResponses",
  "orphanedWork",
  "attempts",
  "circuitOpen",
  "bulkheadFull",
  "fallbacks",
  "timeoutsDelayed",
  "timeoutsLost",
];

export interface SeriesFeatures {
  queue: boolean;
  utilization: boolean;
  breaker: boolean;
}

const QUANTILES = [0.5, 0.95, 0.99] as const;

/** A level that changes over time; integrates level x duration within the current bucket. */
class TimeWeighted {
  level = 0;
  private lastT: Ms = 0;
  private integral = 0;
  private maxLevel = 0;

  set(t: Ms, value: number): void {
    this.integral += this.level * (t - this.lastT);
    this.lastT = t;
    this.level = value;
    if (value > this.maxLevel) this.maxLevel = value;
  }

  /** Closes the bucket at endT; returns [integral, max] and starts the next bucket. */
  close(endT: Ms): [number, number] {
    this.integral += this.level * (endT - this.lastT);
    const out: [number, number] = [this.integral, this.maxLevel];
    this.lastT = endT;
    this.integral = 0;
    this.maxLevel = this.level;
    return out;
  }
}

/** Accumulates the per-bucket series of one entity (global, a node or an edge). */
export class SeriesBuilder {
  private readonly counters = new Map<CounterField, number[]>();
  private readonly percentiles: [(number | null)[], (number | null)[], (number | null)[]] = [
    [],
    [],
    [],
  ];
  private readonly latency = new Histogram();
  private readonly queue: TimeWeighted | null;
  private readonly busy: TimeWeighted | null;
  private readonly effective: TimeWeighted | null;
  private readonly queueAvg: number[] = [];
  private readonly queueMax: number[] = [];
  private readonly utilization: number[] = [];
  private readonly breaker: BreakerState[] = [];
  private breakerNow: BreakerState | null;

  constructor(
    private readonly bucket: () => number,
    private readonly features: SeriesFeatures,
  ) {
    for (const f of COUNTER_FIELDS) this.counters.set(f, []);
    this.queue = features.queue ? new TimeWeighted() : null;
    this.busy = features.utilization ? new TimeWeighted() : null;
    this.effective = features.utilization ? new TimeWeighted() : null;
    this.breakerNow = features.breaker ? "closed" : null;
  }

  inc(field: CounterField, by = 1): void {
    const arr = this.counters.get(field) as number[];
    const b = this.bucket();
    while (arr.length <= b) arr.push(0);
    arr[b] = (arr[b] as number) + by;
  }

  total(field: CounterField): number {
    let sum = 0;
    for (const v of this.counters.get(field) as number[]) sum += v;
    return sum;
  }

  /** True if any counter or latency sample was recorded in bucket `index`. */
  hasDataAt(index: number): boolean {
    if (this.latency.count > 0) return true;
    for (const arr of this.counters.values()) if (arr.length > index) return true;
    return false;
  }

  recordLatency(ms: Ms): void {
    this.latency.record(ms);
  }

  setQueueDepth(t: Ms, depth: number): void {
    this.queue?.set(t, depth);
  }

  setBusy(t: Ms, busy: number): void {
    this.busy?.set(t, busy);
  }

  setEffectiveWorkers(t: Ms, workers: number): void {
    this.effective?.set(t, workers);
  }

  setBreakerState(state: BreakerState): void {
    if (this.features.breaker) this.breakerNow = state;
  }

  /** Closes bucket `index`, which spans [startMs, endMs]. */
  closeBucket(index: number, startMs: Ms, endMs: Ms): void {
    const span = endMs - startMs;
    const qs = this.latency.quantiles(QUANTILES);
    for (let i = 0; i < 3; i++) this.percentiles[i as 0 | 1 | 2][index] = qs[i] ?? null;
    this.latency.reset();
    if (this.queue !== null) {
      const [integral, max] = this.queue.close(endMs);
      this.queueAvg[index] = span > 0 ? integral / span : this.queue.level;
      this.queueMax[index] = max;
    }
    if (this.busy !== null && this.effective !== null) {
      const [busyInt] = this.busy.close(endMs);
      const [effInt] = this.effective.close(endMs);
      this.utilization[index] = utilization(span, busyInt, effInt, this.busy, this.effective);
    }
    if (this.breakerNow !== null) this.breaker[index] = this.breakerNow;
  }

  build(buckets: number, bucketMs: Ms): Series {
    const counter = (f: CounterField): number[] => pad(this.counters.get(f) as number[], buckets);
    const arrivals = counter("arrivals");
    return {
      arrivals,
      rps: arrivals.map((n) => (n * 1000) / bucketMs),
      success: counter("success"),
      degraded: counter("degraded"),
      failed: counter("failed"),
      p50Ms: this.percentiles[0].slice(0, buckets),
      p95Ms: this.percentiles[1].slice(0, buckets),
      p99Ms: this.percentiles[2].slice(0, buckets),
      retries: counter("retries"),
      timeouts: counter("timeouts"),
      rejected503: counter("rejected503"),
      orphanedResponses: counter("orphanedResponses"),
      orphanedWork: counter("orphanedWork"),
      attempts: counter("attempts"),
      circuitOpen: counter("circuitOpen"),
      bulkheadFull: counter("bulkheadFull"),
      fallbacks: counter("fallbacks"),
      timeoutsDelayed: counter("timeoutsDelayed"),
      timeoutsLost: counter("timeoutsLost"),
      queueDepthAvg: this.queue !== null ? this.queueAvg.slice(0, buckets) : null,
      queueDepthMax: this.queue !== null ? this.queueMax.slice(0, buckets) : null,
      utilization: this.busy !== null ? this.utilization.slice(0, buckets) : null,
      breakerState: this.breakerNow !== null ? this.breaker.slice(0, buckets) : null,
    };
  }
}

function utilization(
  span: Ms,
  busyInt: number,
  effInt: number,
  busy: TimeWeighted,
  effective: TimeWeighted,
): number {
  if (span <= 0) return effective.level > 0 ? busy.level / effective.level : 0;
  if (effInt <= 0) return busyInt > 0 ? 1 : 0;
  return busyInt / effInt;
}

function pad(values: number[], length: number): number[] {
  const out = values.slice(0, length);
  while (out.length < length) out.push(0);
  return out;
}
