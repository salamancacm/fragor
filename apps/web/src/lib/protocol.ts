import type { LiveSnapshot, Ms, Scenario, SimulationResult } from "@fragor/engine";
import type { Finding } from "@fragor/scenarios";

/** Messages from the UI to the simulation worker. */
export type ToWorker =
  | { type: "run"; runId: number; scenario: Scenario }
  | { type: "cancel"; runId: number };

/** Messages from the simulation worker to the UI. Plain JSON (structured-clone safe). */
export type FromWorker =
  | { type: "progress"; runId: number; nowMs: Ms; horizonMs: Ms; snapshot: LiveSnapshot }
  | { type: "done"; runId: number; result: SimulationResult; findings: Finding[] }
  | { type: "cancelled"; runId: number }
  | { type: "error"; runId: number; message: string };
