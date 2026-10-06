import { describe, expect, it } from "vitest";
import type { BreakerState, CircuitBreakerPolicy } from "../../src";
import { CircuitBreaker } from "../../src/policies/circuit-breaker";
import { Scheduler } from "../../src/runtime/scheduler";

function setup(policy: Partial<CircuitBreakerPolicy> = {}) {
  const scheduler = new Scheduler(() => {}, undefined);
  const transitions: [BreakerState, BreakerState, number][] = [];
  const cb = new CircuitBreaker(
    {
      requestVolumeThreshold: 4,
      failureRatio: 0.5,
      delayMs: 1000,
      successThreshold: 2,
      ...policy,
    },
    scheduler,
    (from, to, t) => transitions.push([from, to, t]),
  );
  /** Runs one invocation through the breaker; returns false when it is rejected. */
  const call = (failed: boolean): boolean => {
    const g = cb.tryAcquire();
    if (g === null) return false;
    cb.record(g, failed);
    return true;
  };
  return { scheduler, cb, transitions, call };
}

describe("circuit breaker state machine", () => {
  it("MP FT spec scenario 1: S F S S F opens on request 5", () => {
    const { cb, call } = setup();
    for (const failed of [false, true, false, false]) call(failed);
    expect(cb.state).toBe("closed");
    call(true);
    expect(cb.state).toBe("open");
    expect(call(false)).toBe(false);
  });

  it("MP FT spec scenario 2: S F F S opens on request 4, not before the window is full", () => {
    const { cb, call } = setup();
    call(false);
    call(true);
    call(true);
    expect(cb.state).toBe("closed");
    call(false);
    expect(cb.state).toBe("open");
  });

  it("opens when failures >= ceil(failureRatio * requestVolumeThreshold)", () => {
    // Window 5, ratio 0.5: threshold is ceil(2.5) = 3, so 2 failures of 5 never open it.
    const { cb, call } = setup({ requestVolumeThreshold: 5, failureRatio: 0.5 });
    const sequence = [true, true, false, false, false, true, true];
    for (const failed of sequence) call(failed);
    expect(cb.state).toBe("closed"); // last 5: F F F T T -> 2 failures
    call(true); // last 5: F F T T T -> 3 failures
    expect(cb.state).toBe("open");
  });

  it("moves to half-open after delayMs and admits at most successThreshold probes", () => {
    const { scheduler, cb, call, transitions } = setup();
    for (let i = 0; i < 4; i++) call(true);
    scheduler.runUntil(999);
    expect(cb.state).toBe("open");
    scheduler.runUntil(1000);
    expect(cb.state).toBe("half-open");
    const g1 = cb.tryAcquire();
    const g2 = cb.tryAcquire();
    expect(g1).not.toBeNull();
    expect(g2).not.toBeNull();
    expect(cb.tryAcquire()).toBeNull();
    cb.record(g1 as number, false);
    expect(cb.state).toBe("half-open");
    cb.record(g2 as number, false);
    expect(cb.state).toBe("closed");
    expect(transitions.map(([f, t]) => `${f}->${t}`)).toEqual([
      "closed->open",
      "open->half-open",
      "half-open->closed",
    ]);
    expect(transitions[1]?.[2]).toBe(1000);
  });

  it("any probe failure reopens; closing starts a fresh window", () => {
    const { scheduler, cb, call } = setup();
    for (let i = 0; i < 4; i++) call(true);
    scheduler.runUntil(1000);
    call(true);
    expect(cb.state).toBe("open");
    scheduler.runUntil(2000);
    call(false);
    call(false);
    expect(cb.state).toBe("closed");
    for (let i = 0; i < 3; i++) call(true);
    expect(cb.state).toBe("closed"); // fresh window: only 3 of 4 results recorded
  });

  it("ignores results from a previous state (generation)", () => {
    const { cb, call } = setup();
    const stale = cb.tryAcquire() as number;
    for (let i = 0; i < 4; i++) call(true);
    expect(cb.state).toBe("open");
    cb.record(stale, false);
    expect(cb.state).toBe("open");
  });

  it("failOn limits what counts as a failure", () => {
    const { cb } = setup({ failOn: ["timeout"] });
    expect(cb.countsAsFailure("timeout")).toBe(true);
    expect(cb.countsAsFailure("http-5xx")).toBe(false);
  });
});
