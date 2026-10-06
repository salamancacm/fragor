import type { Ms, Series } from "../model/types";
import { SeriesBuilder, type SeriesFeatures } from "./series-builder";

/**
 * Owns the bucket clock and every SeriesBuilder. The kernel calls `advanceTo(t)` before
 * each event, so counters always land in bucket floor(t / bucketMs).
 */
export class MetricsCollector {
  readonly global: SeriesBuilder;
  readonly nodes = new Map<string, SeriesBuilder>();
  readonly edges = new Map<string, SeriesBuilder>();
  private current = 0;
  private readonly bucketFn = (): number => this.current;

  constructor(readonly bucketMs: Ms) {
    if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
      throw new Error(`metrics.bucketMs must be > 0, got ${bucketMs}`);
    }
    this.global = new SeriesBuilder(this.bucketFn, {
      queue: false,
      utilization: false,
      breaker: false,
    });
  }

  addNode(id: string): SeriesBuilder {
    const builder = new SeriesBuilder(this.bucketFn, {
      queue: true,
      utilization: true,
      breaker: false,
    });
    this.nodes.set(id, builder);
    return builder;
  }

  addEdge(id: string, features: Pick<SeriesFeatures, "breaker">): SeriesBuilder {
    const builder = new SeriesBuilder(this.bucketFn, {
      queue: false,
      utilization: false,
      breaker: features.breaker,
    });
    this.edges.set(id, builder);
    return builder;
  }

  get currentBucket(): number {
    return this.current;
  }

  /** Closes every bucket that ends at or before `t`. */
  advanceTo(t: Ms): void {
    while (t >= (this.current + 1) * this.bucketMs) {
      const start = this.current * this.bucketMs;
      this.closeAll(this.current, start, start + this.bucketMs);
      this.current++;
    }
  }

  /**
   * Closes the run at `endMs` and returns the number of buckets. Every bucket spans a full
   * bucketMs: after `endMs` the state is frozen (idle, or unfinished work at the horizon).
   */
  finalize(endMs: Ms): number {
    this.advanceTo(endMs);
    const start = this.current * this.bucketMs;
    if (endMs > start || this.current === 0 || this.hasDataAt(this.current)) {
      this.closeAll(this.current, start, start + this.bucketMs);
      return this.current + 1;
    }
    return this.current;
  }

  build(buckets: number): {
    global: Series;
    nodes: Record<string, Series>;
    edges: Record<string, Series>;
  } {
    const toRecord = (m: Map<string, SeriesBuilder>): Record<string, Series> => {
      const out: Record<string, Series> = {};
      for (const [id, b] of m) out[id] = b.build(buckets, this.bucketMs);
      return out;
    };
    return {
      global: this.global.build(buckets, this.bucketMs),
      nodes: toRecord(this.nodes),
      edges: toRecord(this.edges),
    };
  }

  private hasDataAt(index: number): boolean {
    if (this.global.hasDataAt(index)) return true;
    for (const b of this.nodes.values()) if (b.hasDataAt(index)) return true;
    for (const b of this.edges.values()) if (b.hasDataAt(index)) return true;
    return false;
  }

  private closeAll(index: number, start: Ms, end: Ms): void {
    this.global.closeBucket(index, start, end);
    for (const b of this.nodes.values()) b.closeBucket(index, start, end);
    for (const b of this.edges.values()) b.closeBucket(index, start, end);
  }
}
