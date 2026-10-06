import { createSimulation, DEFAULT_DRAIN_MS, type Ms, type Scenario } from "@fragor/engine";
import { deriveFindings } from "@fragor/scenarios";
import type { FromWorker } from "../lib/protocol";

/** Number of progress messages a run sends (more would cost more than they show). */
const PROGRESS_STEPS = 60;

export function horizonOf(scenario: Scenario): Ms {
  return scenario.durationMs + (scenario.options?.drainMs ?? DEFAULT_DRAIN_MS);
}

/**
 * Runs a simulation in chunks of virtual time, reporting progress after each chunk and yielding
 * between chunks (so a cancel message can be handled). `yieldControl` is injected: the worker
 * passes a macrotask, tests pass an immediate promise.
 */
export async function runInChunks(
  runId: number,
  scenario: Scenario,
  post: (message: FromWorker) => void,
  isCancelled: () => boolean,
  yieldControl: () => Promise<void>,
): Promise<void> {
  try {
    const sim = createSimulation(scenario);
    const horizonMs = horizonOf(scenario);
    const step = Math.max(scenario.metrics?.bucketMs ?? 1000, horizonMs / PROGRESS_STEPS);
    for (let t = step; t < horizonMs; t += step) {
      sim.runUntil(t);
      post({ type: "progress", runId, nowMs: sim.nowMs, horizonMs, snapshot: sim.snapshot() });
      await yieldControl();
      if (isCancelled()) {
        post({ type: "cancelled", runId });
        return;
      }
    }
    const result = sim.finish();
    post({ type: "done", runId, result, findings: deriveFindings(scenario, result) });
  } catch (e) {
    post({ type: "error", runId, message: e instanceof Error ? e.message : String(e) });
  }
}
