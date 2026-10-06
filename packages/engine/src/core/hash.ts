/**
 * Small deterministic string hashes (no crypto, no platform APIs).
 * All arithmetic is 32-bit integer math, identical on every JS engine.
 */

/** 128-bit hash (cyrb128) returned as four uint32 values. Used to seed RNG streams. */
export function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** 128-bit hash as a 32-char lowercase hex string. */
export function hashHex(input: string): string {
  return hash128(input)
    .map((h) => h.toString(16).padStart(8, "0"))
    .join("");
}

/** Hash to a float in [0, 1). Used for order-independent deterministic sampling. */
export function hashUnit(input: string): number {
  const [a] = hash128(input);
  return a / 4294967296;
}
