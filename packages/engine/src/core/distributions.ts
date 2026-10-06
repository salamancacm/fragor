import type { Dist } from "../model/types";
import { detExp, detLog } from "./math";
import type { Rng } from "./rng";

/** A validated, ready-to-use distribution. Returns milliseconds, always finite and >= 0. */
export type Sampler = (rng: Rng) => number;

/** z-score of the 99th percentile of the standard normal distribution. */
export const Z99 = 2.3263;

const MAX_NORMAL_REJECTIONS = 1000;

function fail(path: string, message: string): never {
  throw new Error(`invalid distribution at ${path}: ${message}`);
}

function requireNonNegative(path: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    fail(path, `${name} must be a finite number >= 0, got ${value}`);
  }
}

/**
 * Standard normal sample (Marsaglia polar method, one value per accepted pair). It needs no
 * trigonometry, so with detLog and Math.sqrt (correctly rounded) it is identical in every engine.
 */
export function standardNormal(rng: Rng): number {
  for (;;) {
    const u = 2 * rng.next() - 1;
    const v = 2 * rng.next() - 1;
    const s = u * u + v * v;
    if (s > 0 && s < 1) return u * Math.sqrt((-2 * detLog(s)) / s);
  }
}

/**
 * Validates `dist` and compiles it into a sampler. Throws a descriptive error naming
 * `path` when parameters are invalid.
 */
export function compileDist(dist: Dist, path = "dist"): Sampler {
  switch (dist.type) {
    case "constant": {
      requireNonNegative(path, "ms", dist.ms);
      const ms = dist.ms;
      return () => ms;
    }
    case "uniform": {
      requireNonNegative(path, "minMs", dist.minMs);
      requireNonNegative(path, "maxMs", dist.maxMs);
      if (dist.maxMs < dist.minMs) fail(path, `maxMs (${dist.maxMs}) < minMs (${dist.minMs})`);
      const { minMs, maxMs } = dist;
      return (rng) => minMs + rng.next() * (maxMs - minMs);
    }
    case "normal": {
      requireNonNegative(path, "meanMs", dist.meanMs);
      requireNonNegative(path, "stdMs", dist.stdMs);
      const { meanMs, stdMs } = dist;
      // Truncation at 0 by rejection. With meanMs >= 0 acceptance is >= 50%, so the
      // fallback below has probability < 2^-1000 and exists only to bound the loop.
      return (rng) => {
        for (let i = 0; i < MAX_NORMAL_REJECTIONS; i++) {
          const x = meanMs + stdMs * standardNormal(rng);
          if (x >= 0) return x;
        }
        return 0;
      };
    }
    case "lognormal": {
      if (!Number.isFinite(dist.p50Ms) || dist.p50Ms <= 0) {
        fail(path, `p50Ms must be > 0, got ${dist.p50Ms}`);
      }
      if (!Number.isFinite(dist.p99Ms) || dist.p99Ms < dist.p50Ms) {
        fail(path, `p99Ms (${dist.p99Ms}) must be >= p50Ms (${dist.p50Ms})`);
      }
      const mu = detLog(dist.p50Ms);
      const sigma = (detLog(dist.p99Ms) - mu) / Z99;
      return (rng) => detExp(mu + sigma * standardNormal(rng));
    }
    case "exponential": {
      if (!Number.isFinite(dist.meanMs) || dist.meanMs <= 0) {
        fail(path, `meanMs must be > 0, got ${dist.meanMs}`);
      }
      const meanMs = dist.meanMs;
      return (rng) => -meanMs * detLog(rng.nextOpen());
    }
    case "mixture":
      return compileMixture(dist.components, path);
  }
}

function compileMixture(components: { weight: number; dist: Dist }[], path: string): Sampler {
  if (components.length === 0) fail(path, "mixture needs at least one component");
  let total = 0;
  for (const [i, c] of components.entries()) {
    if (!Number.isFinite(c.weight) || c.weight <= 0) {
      fail(`${path}.components[${i}]`, `weight must be > 0, got ${c.weight}`);
    }
    total += c.weight;
  }
  const cumulative: number[] = [];
  let acc = 0;
  for (const c of components) {
    acc += c.weight / total;
    cumulative.push(acc);
  }
  const samplers = components.map((c, i) => compileDist(c.dist, `${path}.components[${i}].dist`));
  const last = samplers.length - 1;
  return (rng) => {
    const u = rng.next();
    let i = 0;
    while (i < last && u >= (cumulative[i] as number)) i++;
    return (samplers[i] as Sampler)(rng);
  };
}
