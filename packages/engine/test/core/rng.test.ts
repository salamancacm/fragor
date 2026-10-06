import { describe, expect, it } from "vitest";
import { createStream } from "../../src";

function take(n: number, next: () => number): number[] {
  return Array.from({ length: n }, next);
}

describe("Rng sub-streams", () => {
  it("is reproducible for the same seed and path", () => {
    const a = createStream(7, "node", "x", "service");
    const b = createStream(7, "node", "x", "service");
    expect(take(100, () => a.next())).toEqual(take(100, () => b.next()));
  });

  it("differs across seeds, entities and purposes", () => {
    const base = take(10, () => createStream(7, "node", "x", "service").next());
    const r1 = createStream(8, "node", "x", "service");
    const r2 = createStream(7, "node", "y", "service");
    const r3 = createStream(7, "node", "x", "error");
    for (const r of [r1, r2, r3]) expect(take(10, () => r.next())).not.toEqual(base);
  });

  it("does not confuse path boundaries", () => {
    const a = createStream(1, "ab", "c").next();
    const b = createStream(1, "a", "bc").next();
    expect(a).not.toBe(b);
  });

  it("produces values in [0, 1) with a uniform mean", () => {
    const r = createStream(123, "test");
    const n = 100_000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
      sum += v;
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
  });

  it("nextOpen never returns 0", () => {
    const r = createStream(5, "open");
    for (let i = 0; i < 10_000; i++) expect(r.nextOpen()).toBeGreaterThan(0);
  });
});
