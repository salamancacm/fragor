/**
 * Log-linear histogram (HDR-style) for non-negative latencies in milliseconds.
 *
 * Values are quantized to integer nanoseconds. Below 2^SUB_BITS ns buckets are exact;
 * above, each power-of-two range is split into 2^SUB_BITS linear sub-buckets, so a bucket
 * spans at most 1/128 of its lower bound. Reporting the bucket midpoint (clamped to the
 * observed min/max) gives a relative error <= 0.5% for values >= 0.001 ms
 * (half a bucket, 1/256, plus 1 ns of quantization).
 * Index computation uses only integer-exact float operations, so it is identical on every
 * JS engine.
 */
import { detPowInt } from "./math";

const SUB_BITS = 7;
const SUB_COUNT = 1 << SUB_BITS; // 128
const NS_PER_MS = 1_000_000;
const TWO_32 = 4294967296;

function floorLog2(n: number): number {
  if (n < TWO_32) return 31 - Math.clz32(n);
  return 32 + 31 - Math.clz32(Math.floor(n / TWO_32));
}

export function bucketIndex(valueMs: number): number {
  const ns = Math.floor(valueMs * NS_PER_MS);
  if (ns < SUB_COUNT) return ns;
  const shift = floorLog2(ns) - SUB_BITS;
  const sub = Math.floor(ns / detPowInt(2, shift)); // in [SUB_COUNT, 2 * SUB_COUNT)
  return (shift + 1) * SUB_COUNT + (sub - SUB_COUNT);
}

/** Midpoint of bucket `index`, in milliseconds. */
export function bucketMidpointMs(index: number): number {
  if (index < SUB_COUNT) return (index + 0.5) / NS_PER_MS;
  const shift = Math.floor(index / SUB_COUNT) - 1;
  const sub = (index % SUB_COUNT) + SUB_COUNT;
  const width = detPowInt(2, shift);
  return (sub * width + width / 2) / NS_PER_MS;
}

export class Histogram {
  private counts: number[] = [];
  private touched: number[] = [];
  private total = 0;
  private sum = 0;
  private min = Number.POSITIVE_INFINITY;
  private max = Number.NEGATIVE_INFINITY;

  get count(): number {
    return this.total;
  }

  record(valueMs: number): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) {
      throw new Error(`histogram value must be finite and >= 0, got ${valueMs}`);
    }
    const i = bucketIndex(valueMs);
    const c = this.counts[i];
    if (c === undefined || c === 0) {
      this.counts[i] = 1;
      this.touched.push(i);
    } else {
      this.counts[i] = c + 1;
    }
    this.total++;
    this.sum += valueMs;
    if (valueMs < this.min) this.min = valueMs;
    if (valueMs > this.max) this.max = valueMs;
  }

  mean(): number | null {
    return this.total === 0 ? null : this.sum / this.total;
  }

  /** Values for each quantile q in [0, 1]; null entries when the histogram is empty. */
  quantiles(qs: readonly number[]): (number | null)[] {
    if (this.total === 0) return qs.map(() => null);
    const order = [...this.touched].sort((a, b) => a - b);
    return qs.map((q) => {
      const rank = Math.max(1, Math.ceil(q * this.total));
      let seen = 0;
      for (const i of order) {
        seen += this.counts[i] ?? 0;
        if (seen >= rank) return this.clamp(bucketMidpointMs(i));
      }
      return this.max;
    });
  }

  reset(): void {
    for (const i of this.touched) this.counts[i] = 0;
    this.touched = [];
    this.total = 0;
    this.sum = 0;
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
  }

  private clamp(v: number): number {
    return Math.min(this.max, Math.max(this.min, v));
  }
}
