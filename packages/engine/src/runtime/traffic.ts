import type { Rng } from "../core/rng";
import type { Ms, TrafficPattern, TrafficSpec } from "../model/types";
import type { ScheduledEvent, Scheduler } from "./scheduler";

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
 * Generates arrivals for one traffic source on [startMs, min(endMs, durationMs)).
 * constant: evenly spaced, first arrival at startMs.
 * poisson, ramp, spike: (non-homogeneous) Poisson process sampled by thinning, using the
 * maximum rate of the current segment as the bound.
 * A traffic-multiply fault scales the rate; when it changes, the pending arrival is redrawn
 * from the current time (exact for Poisson processes, which are memoryless).
 */
export class TrafficSource {
  private readonly startMs: Ms;
  private readonly endMs: Ms;
  private readonly model: ReturnType<typeof rateModel>;
  private pending: ScheduledEvent | null = null;
  /** constant pattern: arrivals are anchor + k * interval since the last rate change. */
  private anchorMs: Ms;
  private k = 0;
  private lastArrivalMs: Ms | null = null;
  private factor: number;

  constructor(
    private readonly spec: TrafficSpec,
    durationMs: Ms,
    private readonly scheduler: Scheduler,
    private readonly rng: Rng,
    private readonly rateFactor: () => number,
    private readonly onArrival: (spec: TrafficSpec) => void,
  ) {
    validatePattern(spec.id, spec.pattern);
    this.startMs = spec.startMs ?? 0;
    this.endMs = Math.min(spec.endMs ?? durationMs, durationMs);
    this.model = rateModel(spec.pattern, this.startMs);
    this.anchorMs = this.startMs;
    this.factor = rateFactor();
  }

  start(): void {
    this.scheduleNext(this.isConstant() ? this.constantNext() : this.nextPoisson(this.startMs));
  }

  /** Called when a traffic-multiply fault on this source starts or ends. */
  onRateChanged(): void {
    const now = this.scheduler.nowMs;
    this.factor = this.rateFactor();
    if (this.pending !== null) this.scheduler.cancel(this.pending);
    this.pending = null;
    if (now >= this.endMs) return;
    if (this.isConstant()) {
      // Re-anchor at the last arrival so the new interval applies from there; never in the past.
      if (this.lastArrivalMs === null) {
        this.anchorMs = Math.max(now, this.startMs);
        this.k = 0;
      } else {
        this.anchorMs = this.lastArrivalMs;
        this.k = 1;
      }
      const next = this.constantNext();
      if (next !== null && next < now) {
        this.anchorMs = now;
        this.k = 0;
      }
      this.scheduleNext(this.constantNext());
    } else {
      this.scheduleNext(this.nextPoisson(Math.max(now, this.startMs)));
    }
  }

  private isConstant(): boolean {
    return this.spec.pattern.type === "constant";
  }

  private scheduleNext(t: Ms | null): void {
    if (t === null) return;
    this.pending = this.scheduler.schedule(t, "TRAFFIC_ARRIVAL", () => {
      this.pending = null;
      this.lastArrivalMs = t;
      this.onArrival(this.spec);
      if (this.isConstant()) {
        this.k++;
        this.scheduleNext(this.constantNext());
      } else {
        this.scheduleNext(this.nextPoisson(t));
      }
    });
  }

  /** Next arrival of a constant pattern; computed by multiplication to avoid drift. */
  private constantNext(): Ms | null {
    const rps = this.model.rateAt(this.startMs) * this.factor;
    if (rps <= 0) return null;
    const t = this.anchorMs + (this.k * 1000) / rps;
    return t < this.endMs ? t : null;
  }

  private nextPoisson(from: Ms): Ms | null {
    let t = from;
    for (;;) {
      if (t >= this.endMs) return null;
      const seg = this.segmentAt(t);
      const max = seg.maxRps * this.factor;
      if (max <= 0) {
        t = seg.endMs;
        continue;
      }
      const candidate = t - (1000 / max) * Math.log(this.rng.nextOpen());
      if (candidate >= seg.endMs) {
        t = seg.endMs;
        continue;
      }
      if (candidate >= this.endMs) return null;
      if (this.rng.next() * max < this.model.rateAt(candidate) * this.factor) return candidate;
      t = candidate;
    }
  }

  private segmentAt(t: Ms): Segment {
    for (const s of this.model.segments) if (t < s.endMs) return s;
    throw new Error(`traffic[${this.spec.id}]: no rate segment covers t=${t}`);
  }
}
