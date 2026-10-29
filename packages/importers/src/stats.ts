/** Quantile `q` (0..1) of an ascending list, interpolating between neighbors. NaN when empty. */
export function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export const ascending = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

/** The ms values below this are clock noise, not time: a response time must be positive. */
export const MIN_MS = 0.1;

/** Median and 99th percentile of response-time samples, floored so both are positive. */
export function latencyQuantiles(samples: readonly number[]): { p50Ms: number; p99Ms: number } {
  const s = ascending(samples);
  const p50Ms = Math.max(MIN_MS, quantile(s, 0.5));
  return { p50Ms, p99Ms: Math.max(p50Ms, quantile(s, 0.99)) };
}

/**
 * The lower edge of the first tight cluster of `values`: the smallest value g with at least
 * `minCount` values in [g, g * (1 + tolerance)]. A timeout shows up as many observations just
 * above one value (lateness only adds), so the floor of that cluster estimates it. Null when
 * nothing clusters (scattered values say nothing).
 */
export function clusterFloor(
  values: readonly number[],
  minCount: number,
  tolerance = 0.15,
): number | null {
  const s = ascending(values);
  for (let i = 0; i + minCount <= s.length; i++) {
    const g = s[i] as number;
    if (g <= 0) continue;
    let j = i;
    while (j < s.length && (s[j] as number) <= g * (1 + tolerance)) j++;
    if (j - i >= minCount) return g;
  }
  return null;
}

/** Total length covered by `[start, end]` intervals, counting overlaps once. */
export function unionLength(intervals: readonly (readonly [number, number])[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = Number.NaN;
  let curEnd = Number.NaN;
  for (const [s, e] of sorted) {
    if (Number.isNaN(curStart) || s > curEnd) {
      if (!Number.isNaN(curStart)) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  return Number.isNaN(curStart) ? 0 : total + (curEnd - curStart);
}
