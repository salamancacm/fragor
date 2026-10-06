import type { Rng } from "../core/rng";
import type { Ms, TrafficPattern, TrafficSpec } from "../model/types";
import type { Scheduler } from "./scheduler";

/** A piece of the rate function: on [startMs, endMs) the rate never exceeds maxRps. */
interface Segment {
  startMs: Ms;
  endMs: Ms;
  maxRps: number;
}

function requireRate(id: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`traffic[${id}].pattern.${name} must be a finite number >= 0, got ${value}`);
  }
}

function requireDuration(id: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`traffic[${id}].pattern.${name} must be a finite number >= 0, got ${value}`);
  }
}

/** Linear interpolation of the rate between two points. */
function lerp(t: Ms, t0: Ms, t1: Ms, r0: number, r1: number): number {
  if (t1 <= t0) return r1;
  return r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
}

/**
 * Rate function (rps) of a variable pattern plus its segments.
 * ramp: from startMs, linear fromRps -> toRps over durationMs, then toRps.
 * spike: baseRps; at atMs (absolute) linear up to peakRps over rampMs, hold holdMs,
 *        linear down over rampMs, then baseRps.
 */
export function rateModel(
  pattern: TrafficPattern,
  startMs: Ms,
): { rateAt: (t: Ms) => number; segments: Segment[] } {
  const INF = Number.POSITIVE_INFINITY;
  switch (pattern.type) {
    case "constant":
    case "poisson":
      return {
        rateAt: () => pattern.rps,
        segments: [{ startMs, endMs: INF, maxRps: pattern.rps }],
      };
    case "ramp": {
      const end = startMs + pattern.durationMs;
      const { fromRps, toRps } = pattern;
      return {
        rateAt: (t) => (t < end ? lerp(t, startMs, end, fromRps, toRps) : toRps),
        segments: [
          { startMs, endMs: end, maxRps: Math.max(fromRps, toRps) },
          { startMs: end, endMs: INF, maxRps: toRps },
        ],
      };
    }
    case "spike": {
      const { baseRps, peakRps, atMs, holdMs } = pattern;
      const rampMs = pattern.rampMs ?? 0;
      const up = atMs + rampMs;
      const holdEnd = up + holdMs;
      const down = holdEnd + rampMs;
      const top = Math.max(baseRps, peakRps);
      return {
        rateAt: (t) => {
          if (t < atMs || t >= down) return baseRps;
          if (t < up) return lerp(t, atMs, up, baseRps, peakRps);
          if (t < holdEnd) return peakRps;
          return lerp(t, holdEnd, down, peakRps, baseRps);
        },
        segments: [
          { startMs: Number.NEGATIVE_INFINITY, endMs: atMs, maxRps: baseRps },
          { startMs: atMs, endMs: up, maxRps: top },
          { startMs: up, endMs: holdEnd, maxRps: peakRps },
          { startMs: holdEnd, endMs: down, maxRps: top },
          { startMs: down, endMs: INF, maxRps: baseRps },
        ].filter((s) => s.endMs > s.startMs),
      };
    }
  }
}

export function validatePattern(id: string, pattern: TrafficPattern): void {
  switch (pattern.type) {
    case "constant":
    case "poisson":
      requireRate(id, "rps", pattern.rps);
      return;
    case "ramp":
      requireRate(id, "fromRps", pattern.fromRps);
      requireRate(id, "toRps", pattern.toRps);
      requireDuration(id, "durationMs", pattern.durationMs);
      return;
    case "spike":
      requireRate(id, "baseRps", pattern.baseRps);
      requireRate(id, "peakRps", pattern.peakRps);
      requireDuration(id, "atMs", pattern.atMs);
      requireDuration(id, "holdMs", pattern.holdMs);
      requireDuration(id, "rampMs", pattern.rampMs ?? 0);
      return;
  }
}

/**
 * Generates arrivals for one traffic source on [startMs, endMs).
 * constant: evenly spaced, first arrival at startMs.
 * poisson, ramp, spike: (non-homogeneous) Poisson process sampled by thinning, using the
 * maximum rate of the current segment as the bound.
 */
export class TrafficSource {
  private readonly startMs: Ms;
  private readonly endMs: Ms;
  private readonly model: ReturnType<typeof rateModel>;
  private count = 0;

  constructor(
    private readonly spec: TrafficSpec,
    durationMs: Ms,
    private readonly scheduler: Scheduler,
    private readonly rng: Rng,
    private readonly onArrival: (spec: TrafficSpec) => void,
  ) {
    validatePattern(spec.id, spec.pattern);
    this.startMs = spec.startMs ?? 0;
    this.endMs = Math.min(spec.endMs ?? durationMs, durationMs);
    this.model = rateModel(spec.pattern, this.startMs);
  }

  start(): void {
    const first =
      this.spec.pattern.type === "constant" ? this.constantAt(0) : this.nextPoisson(this.startMs);
    this.scheduleAt(first);
  }

  private scheduleAt(t: Ms | null): void {
    if (t === null) return;
    this.scheduler.schedule(t, "TRAFFIC_ARRIVAL", () => {
      this.count++;
      this.onArrival(this.spec);
      this.scheduleAt(
        this.spec.pattern.type === "constant" ? this.constantAt(this.count) : this.nextPoisson(t),
      );
    });
  }

  /** k-th arrival of a constant pattern; computed by multiplication to avoid drift. */
  private constantAt(k: number): Ms | null {
    const rps = this.model.rateAt(this.startMs);
    if (rps <= 0) return null;
    const t = this.startMs + (k * 1000) / rps;
    return t < this.endMs ? t : null;
  }

  private nextPoisson(from: Ms): Ms | null {
    let t = from;
    for (;;) {
      if (t >= this.endMs) return null;
      const seg = this.segmentAt(t);
      if (seg.maxRps <= 0) {
        t = seg.endMs;
        continue;
      }
      const candidate = t - (1000 / seg.maxRps) * Math.log(this.rng.nextOpen());
      if (candidate >= seg.endMs) {
        t = seg.endMs;
        continue;
      }
      if (candidate >= this.endMs) return null;
      if (this.rng.next() * seg.maxRps < this.model.rateAt(candidate)) return candidate;
      t = candidate;
    }
  }

  private segmentAt(t: Ms): Segment {
    for (const s of this.model.segments) if (t < s.endMs) return s;
    throw new Error(`traffic[${this.spec.id}]: no rate segment covers t=${t}`);
  }
}
