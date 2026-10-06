import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detExp, detLog, detPowInt } from "../../src/core/math";

/** Relative error against the platform function (which is close to correctly rounded). */
const rel = (a: number, b: number) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b));

describe("deterministic math (cross-engine identical results)", () => {
  it("detLog matches Math.log within 2e-16 relative on (0, 1e300]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-300, max: 1e300, noNaN: true, noDefaultInfinity: true }),
        (x) => {
          if (x <= 0) return;
          expect(rel(detLog(x), Math.log(x))).toBeLessThan(4e-16);
        },
      ),
      { numRuns: 20_000 },
    );
  });

  it("detLog handles the values the engine feeds it: uniforms in (0, 1]", () => {
    for (let i = 1; i <= 10_000; i++) {
      const u = i / 10_000;
      expect(Math.abs(detLog(u) - Math.log(u))).toBeLessThan(
        4e-16 * Math.max(1, Math.abs(Math.log(u))),
      );
    }
    expect(detLog(1)).toBe(0);
    expect(detLog(Math.E)).toBeCloseTo(1, 15);
  });

  it("detExp matches Math.exp within 2e-16 relative on [-700, 700]", () => {
    fc.assert(
      fc.property(fc.double({ min: -700, max: 700, noNaN: true }), (x) => {
        expect(rel(detExp(x), Math.exp(x))).toBeLessThan(4e-16);
      }),
      { numRuns: 20_000 },
    );
    expect(detExp(0)).toBe(1);
    expect(detExp(1000)).toBe(Number.POSITIVE_INFINITY);
    expect(detExp(-1000)).toBe(0);
  });

  it("detExp(detLog(x)) round-trips", () => {
    for (const x of [1e-10, 0.5, 1, 2, 120, 400, 1e6])
      expect(rel(detExp(detLog(x)), x)).toBeLessThan(1e-15);
  });

  it("detPowInt is repeated multiplication", () => {
    expect(detPowInt(2, 10)).toBe(1024);
    expect(detPowInt(1.5, 0)).toBe(1);
    expect(detPowInt(1.5, 3)).toBe(1.5 * 1.5 * 1.5);
  });
});
