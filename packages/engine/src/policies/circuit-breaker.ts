import type { BreakerState, CircuitBreakerPolicy, FailureKind, Ms } from "../model/types";
import type { Scheduler } from "../runtime/scheduler";

/**
 * Circuit breaker modeled on SmallRye Fault Tolerance 6.11 (see docs/SEMANTICS.md, 6.7).
 *
 * - CLOSED: rolling window of the last `requestVolumeThreshold` results. Evaluated only when the
 *   window is full; opens when failures >= ceil(failureRatio * requestVolumeThreshold).
 * - OPEN: rejects every attempt; after `delayMs` moves to HALF_OPEN (BREAKER_HALF_OPEN_DUE).
 * - HALF_OPEN: admits at most `successThreshold` probes, rejects the rest; any probe failure
 *   reopens, `successThreshold` probe successes close it with a fresh window.
 *
 * Every transition starts a new generation. A result is recorded only against the generation it
 * was admitted in, mirroring SmallRye's compareAndSet on its state object: late results from a
 * previous state are ignored.
 */
export class CircuitBreaker {
  private stateNow: BreakerState = "closed";
  private generation = 0;
  private window: boolean[];
  private recorded = 0;
  private failures = 0;
  private probes = 0;
  private probeSuccesses = 0;
  private readonly threshold: number;

  constructor(
    private readonly policy: CircuitBreakerPolicy,
    private readonly scheduler: Scheduler,
    private readonly onTransition: (from: BreakerState, to: BreakerState, atMs: Ms) => void,
  ) {
    this.window = new Array<boolean>(policy.requestVolumeThreshold).fill(false);
    this.threshold = Math.ceil(policy.failureRatio * policy.requestVolumeThreshold);
  }

  get state(): BreakerState {
    return this.stateNow;
  }

  /** Returns the generation the attempt is admitted in, or null when it is rejected. */
  tryAcquire(): number | null {
    switch (this.stateNow) {
      case "closed":
        return this.generation;
      case "open":
        return null;
      case "half-open":
        this.probes++;
        return this.probes > this.policy.successThreshold ? null : this.generation;
    }
  }

  /** Whether a failure kind counts as a failure for this breaker (failOn, default: all). */
  countsAsFailure(kind: FailureKind): boolean {
    return this.policy.failOn === undefined || this.policy.failOn.includes(kind);
  }

  record(generation: number, failed: boolean): void {
    if (generation !== this.generation) return;
    if (this.stateNow === "closed") this.recordClosed(failed);
    else if (this.stateNow === "half-open") this.recordHalfOpen(failed);
  }

  /** An admitted half-open probe that will never report (cancelled) frees its slot. */
  releaseProbe(generation: number): void {
    if (generation === this.generation && this.stateNow === "half-open" && this.probes > 0) {
      this.probes--;
    }
  }

  private recordClosed(failed: boolean): void {
    const size = this.window.length;
    const slot = this.recorded % size;
    if (this.recorded >= size && this.window[slot] === true) this.failures--;
    this.window[slot] = failed;
    if (failed) this.failures++;
    this.recorded++;
    if (this.recorded >= size && this.failures >= this.threshold) this.transition("open");
  }

  private recordHalfOpen(failed: boolean): void {
    if (failed) {
      this.transition("open");
      return;
    }
    this.probeSuccesses++;
    if (this.probeSuccesses >= this.policy.successThreshold) this.transition("closed");
  }

  private transition(to: BreakerState): void {
    const from = this.stateNow;
    this.stateNow = to;
    this.generation++;
    this.probes = 0;
    this.probeSuccesses = 0;
    if (to === "closed") {
      this.window = new Array<boolean>(this.policy.requestVolumeThreshold).fill(false);
      this.recorded = 0;
      this.failures = 0;
    }
    const now = this.scheduler.nowMs;
    this.onTransition(from, to, now);
    if (to === "open") {
      const generation = this.generation;
      this.scheduler.schedule(now + this.policy.delayMs, "BREAKER_HALF_OPEN_DUE", () => {
        if (this.generation === generation) this.transition("half-open");
      });
    }
  }
}
