/**
 * The ONLY place where the engine reads real time. It is used exclusively to report
 * `stats.wallClockMs`, which is excluded from the fingerprint. Simulation logic must never
 * import this module (a test enforces it).
 */
interface PerformanceLike {
  now(): number;
}

export function wallClockNow(): number {
  const perf = (globalThis as { performance?: PerformanceLike }).performance;
  return perf !== undefined ? perf.now() : Date.now();
}
