import type { Ms } from "@fragor/engine";

export interface Window {
  /** First bucket index (inclusive). */
  from: number;
  /** Last bucket index (inclusive). */
  to: number;
}

export function sum(xs: readonly number[], w?: Window): number {
  let total = 0;
  const from = w?.from ?? 0;
  const to = w?.to ?? xs.length - 1;
  for (let i = from; i <= to; i++) total += xs[i] ?? 0;
  return total;
}

export function maxOf(xs: readonly (number | null)[], w?: Window): number | null {
  let best: number | null = null;
  const from = w?.from ?? 0;
  const to = w?.to ?? xs.length - 1;
  for (let i = from; i <= to; i++) {
    const v = xs[i];
    if (v !== null && v !== undefined && (best === null || v > best)) best = v;
  }
  return best;
}

export function mean(xs: readonly number[], w: Window): number {
  return sum(xs, w) / (w.to - w.from + 1);
}

/** Maximal runs of consecutive buckets satisfying `pred`. */
export function runs(length: number, pred: (i: number) => boolean): Window[] {
  const out: Window[] = [];
  let start = -1;
  for (let i = 0; i <= length; i++) {
    const ok = i < length && pred(i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      out.push({ from: start, to: i - 1 });
      start = -1;
    }
  }
  return out;
}

/** Smallest window covering every bucket where `xs[i] > 0`, or null. */
export function activeWindow(xs: readonly number[]): Window | null {
  const first = xs.findIndex((v) => v > 0);
  if (first < 0) return null;
  let last = first;
  for (let i = xs.length - 1; i > first; i--) {
    if ((xs[i] ?? 0) > 0) {
      last = i;
      break;
    }
  }
  return { from: first, to: last };
}

export function toMs(w: Window, bucketMs: Ms): { fromMs: Ms; toMs: Ms } {
  return { fromMs: w.from * bucketMs, toMs: (w.to + 1) * bucketMs };
}

/** Rounds for human-facing text and the digest (keeps results stable and short). */
export function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
