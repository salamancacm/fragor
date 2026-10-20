import type { Tone } from "./events";
import type { LinkFlow } from "./flow";

/**
 * Decorative particles that make the flow visible: one dot stands for `perDot` requests. They
 * never feed back into any number shown; their only randomness (jitter, response color order) comes
 * from a small seeded generator, so the animation is reproducible too.
 */
export type ParticleKind = "request" | "response" | "rejected";

export interface Particle {
  link: number;
  kind: ParticleKind;
  tone: Tone;
  /** Progress along the link, 0..1 (rejected dots continue past their stop point as a fall). */
  p: number;
  jitter: number;
}

/** Wall-clock seconds a dot takes to cross a link. */
export const TRAVEL_S = 0.9;
const MAX_PARTICLES = 1500;
/** Target dots per wall-clock second on the busiest link. */
const DOTS_PER_S = 70;

/** mulberry32: tiny seeded PRNG, display only. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Requests per dot so the busiest link of the run shows about DOTS_PER_S dots per second. */
export function requestsPerDot(peakPerBucket: number, bucketMs: number): number {
  const perSecond = (peakPerBucket * 1000) / bucketMs;
  return Math.max(1, perSecond / DOTS_PER_S);
}

export class ParticleField {
  particles: Particle[] = [];
  private readonly next: () => number;
  private credit: { request: number; response: number; rejected: number }[] = [];

  constructor(
    seed: number,
    private readonly perDot: number,
    private readonly bucketMs: number,
  ) {
    this.next = rng(seed);
  }

  clear(): void {
    this.particles = [];
    this.credit = [];
  }

  /**
   * Spawns dots for `dtRealS` of wall time from each link's flow in the current bucket. Density
   * follows the per-second rate, independently of the playback speed, so it stays readable at 10x.
   */
  spawn(flows: readonly LinkFlow[], dtRealS: number): void {
    const scale = (1000 / this.bucketMs / this.perDot) * dtRealS;
    flows.forEach((f, link) => {
      const c = this.credit[link] ?? { request: 0, response: 0, rejected: 0 };
      this.credit[link] = c;
      c.request += f.sent * scale;
      c.rejected += f.rejected * scale;
      const answered = f.ok + f.degraded + f.failed;
      c.response += answered * scale;
      for (; c.request >= 1; c.request--) this.add(link, "request", "ok");
      for (; c.rejected >= 1; c.rejected--) this.add(link, "rejected", "bad");
      for (; c.response >= 1; c.response--) {
        const u = this.next() * answered;
        this.add(link, "response", u < f.ok ? "ok" : u < f.ok + f.degraded ? "deg" : "bad");
      }
    });
  }

  /** Moves every dot by `dtRealS` and drops the ones that arrived or faded. */
  step(dtRealS: number): void {
    const dp = dtRealS / TRAVEL_S;
    this.particles = this.particles.filter((q) => {
      q.p += dp;
      // Rejected dots fall away after stopping, so give them a little longer.
      return q.kind === "rejected" ? q.p < 1.5 : q.p < 1;
    });
  }

  private add(link: number, kind: ParticleKind, tone: Tone): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ link, kind, tone, p: 0, jitter: (this.next() - 0.5) * 6 });
  }
}
