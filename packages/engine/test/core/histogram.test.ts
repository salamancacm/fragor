import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createStream, Histogram } from "../../src";
import { bucketIndex, bucketMidpointMs } from "../../src/core/histogram";
import { quantileSorted, relErr } from "../helpers";

describe("log-linear histogram", () => {
  it("bucket midpoint is within 0.5% of any value >= 0.001 ms", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 1e8, noNaN: true }), (v) => {
        expect(relErr(bucketMidpointMs(bucketIndex(v)), v)).toBeLessThanOrEqual(0.005);
      }),
      { numRuns: 5000 },
    );
  });

  it("bucket index is monotonic in the value", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(bucketIndex(lo)).toBeLessThanOrEqual(bucketIndex(hi));
        },
      ),
    );
  });

  it("quantiles stay within 1% of exact quantiles on a heavy-tailed sample", () => {
    const rng = createStream(9, "hist");
    const h = new Histogram();
    const xs: number[] = [];
    for (let i = 0; i < 50_000; i++) {
      const v = Math.exp(3 + 1.5 * (rng.next() * 4 - 2));
      xs.push(v);
      h.record(v);
    }
    xs.sort((a, b) => a - b);
    const qs = [0.5, 0.9, 0.95, 0.99, 0.999];
    h.quantiles(qs).forEach((got, i) => {
      expect(relErr(got as number, quantileSorted(xs, qs[i] as number))).toBeLessThanOrEqual(0.01);
    });
  });

  it("is exact for constant values and empty -> null", () => {
    const h = new Histogram();
    expect(h.quantiles([0.5])).toEqual([null]);
    expect(h.mean()).toBeNull();
    for (let i = 0; i < 10; i++) h.record(5000);
    expect(h.quantiles([0.5, 0.99])).toEqual([5000, 5000]);
    h.reset();
    expect(h.count).toBe(0);
  });

  it("rejects negative and non-finite values", () => {
    const h = new Histogram();
    expect(() => h.record(-1)).toThrow();
    expect(() => h.record(Number.POSITIVE_INFINITY)).toThrow();
  });
});
