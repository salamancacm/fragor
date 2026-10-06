"use client";

import type { LiveSnapshot, Scenario, SimulationResult } from "@fragor/engine";
import type { Finding } from "@fragor/scenarios";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { FromWorker, ToWorker } from "./protocol";

export interface RunRecord {
  runId: number;
  label: string;
  scenario: Scenario;
  result: SimulationResult;
  findings: Finding[];
}

interface Running {
  runId: number;
  label: string;
  scenario: Scenario;
  progress: number;
  snapshot: LiveSnapshot | null;
}

export interface SimulationState {
  running: Running | null;
  error: string | null;
  /** Latest finished run. */
  current: RunRecord | null;
  /** The run before it: the "before" of the comparison. */
  previous: RunRecord | null;
}

type Action =
  | { type: "start"; runId: number; label: string; scenario: Scenario }
  | { type: "message"; message: FromWorker };

const INITIAL: SimulationState = { running: null, error: null, current: null, previous: null };

export function reducer(state: SimulationState, action: Action): SimulationState {
  if (action.type === "start") {
    const { runId, label, scenario } = action;
    return {
      ...state,
      error: null,
      running: { runId, label, scenario, progress: 0, snapshot: null },
    };
  }
  const m = action.message;
  const running = state.running;
  if (running === null || running.runId !== m.runId) return state; // stale message
  switch (m.type) {
    case "progress":
      return {
        ...state,
        running: { ...running, progress: m.nowMs / m.horizonMs, snapshot: m.snapshot },
      };
    case "done":
      return {
        running: null,
        error: null,
        previous: state.current,
        current: {
          runId: m.runId,
          label: running.label,
          scenario: running.scenario,
          result: m.result,
          findings: m.findings,
        },
      };
    case "cancelled":
      return { ...state, running: null };
    case "error":
      return { ...state, running: null, error: m.message };
  }
}

/** Owns the simulation Web Worker; each finished run becomes `current` and the old one `previous`. */
export function useSimulation() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const worker = useRef<Worker | null>(null);
  const nextRunId = useRef(1);
  const activeRun = useRef<number | null>(null);

  useEffect(() => {
    const w = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<FromWorker>) =>
      dispatch({ type: "message", message: event.data });
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  const send = useCallback((message: ToWorker) => worker.current?.postMessage(message), []);

  const run = useCallback(
    (scenario: Scenario, label: string) => {
      if (activeRun.current !== null) send({ type: "cancel", runId: activeRun.current });
      const runId = nextRunId.current++;
      activeRun.current = runId;
      dispatch({ type: "start", runId, label, scenario });
      send({ type: "run", runId, scenario });
    },
    [send],
  );

  const cancel = useCallback(() => {
    if (activeRun.current !== null) send({ type: "cancel", runId: activeRun.current });
  }, [send]);

  return { state, run, cancel };
}
