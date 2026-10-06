import { hash128 } from "./hash";

/**
 * Seeded PRNG (sfc32). Each simulated entity owns independent sub-streams derived from
 * hash(seed, entity, purpose), so adding or removing an entity never shifts the random
 * sequence of another one.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
    // Discard the first outputs so similar seeds diverge.
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float in (0, 1]. Safe for logarithms. */
  nextOpen(): number {
    return (this.nextUint32() + 1) / 4294967296;
  }
}

/** Creates the sub-stream for (seed, ...path), e.g. createStream(42, "node", "order", "service"). */
export function createStream(seed: number, ...path: string[]): Rng {
  if (!Number.isFinite(seed)) throw new Error(`seed must be a finite number, got ${seed}`);
  const [a, b, c, d] = hash128(`${seed}\u0000${path.join("\u0000")}`);
  return new Rng(a, b, c, d);
}
