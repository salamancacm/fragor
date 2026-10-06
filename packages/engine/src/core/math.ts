/**
 * Deterministic logarithm and exponential.
 *
 * ECMAScript lets engines approximate Math.log / Math.exp / Math.cos / Math.pow differently, and in
 * practice Node and browsers disagree in the last bit for some inputs, which changes simulation
 * fingerprints. These implementations use only +, -, *, / (exactly rounded by IEEE 754 in every
 * engine), exact bit manipulation and Math.floor, so they return the same bits everywhere.
 * Accuracy: within about 2 ulp of the true value, more than enough for sampling.
 */

// Scratch buffer for exact bit access; holds no state between calls.
const view = new DataView(new ArrayBuffer(8));

/** ln 2 split so that k * LN2_HI is exact for |k| < 2^20 (fdlibm constants). */
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = Math.LOG2E; // defined by the spec as the Number value nearest log2(e)
const SQRT2 = Math.SQRT2; // defined by the spec as the Number value nearest sqrt(2)
const TWO_54 = 18014398509481984;

/** 2^k for an integer k in [-1022, 1023], built from its bits (exact). */
function pow2(k: number): number {
  view.setUint32(0, (k + 1023) << 20);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

/** Natural logarithm. detLog(0) = -Infinity; negative or NaN input gives NaN. */
export function detLog(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return x;
  let k = 0;
  let v = x;
  view.setFloat64(0, v);
  if (((view.getUint32(0) >>> 20) & 0x7ff) === 0) {
    v *= TWO_54; // subnormal: scale into the normal range (exact)
    k -= 54;
    view.setFloat64(0, v);
  }
  const hi = view.getUint32(0);
  k += ((hi >>> 20) & 0x7ff) - 1023;
  view.setUint32(0, (hi & 0x000fffff) | 0x3ff00000); // mantissa with exponent 0: m in [1, 2)
  let m = view.getFloat64(0);
  if (m > SQRT2) {
    m /= 2;
    k += 1;
  }
  // log(m) = 2 atanh(s), s = (m - 1) / (m + 1), |s| <= 0.1716
  const f = m - 1;
  const s = f / (2 + f);
  const s2 = s * s;
  let p = 1 / 23;
  for (let n = 21; n >= 1; n -= 2) p = p * s2 + 1 / n;
  return k * LN2_HI + (k * LN2_LO + 2 * s * p);
}

/** 1/n! for n = 0..13, as decimal literals (parsed with correct rounding everywhere). */
const INV_FACT = [
  1, 1, 0.5, 1.6666666666666666e-1, 4.1666666666666664e-2, 8.333333333333333e-3,
  1.388888888888889e-3, 1.984126984126984e-4, 2.48015873015873e-5, 2.7557319223985893e-6,
  2.755731922398589e-7, 2.505210838544172e-8, 2.08767569878681e-9, 1.6059043836821613e-10,
];

/** Exponential function. */
export function detExp(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x > 709.782712893384) return Number.POSITIVE_INFINITY;
  if (x < -745.1332191019411) return 0;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| <= 0.347
  let p = INV_FACT[13] as number;
  for (let n = 12; n >= 0; n--) p = p * r + (INV_FACT[n] as number);
  if (k > 1023) return p * pow2(k - 1) * 2;
  if (k < -1022) return p * pow2(k + 54) * (1 / TWO_54);
  return p * pow2(k);
}

/** base^n for a non-negative integer n, by repeated multiplication (exact operation order). */
export function detPowInt(base: number, n: number): number {
  let out = 1;
  for (let i = 0; i < n; i++) out *= base;
  return out;
}
