/// <reference lib="webworker" />
import type { FromWorker, ToWorker } from "../lib/protocol";
import { runInChunks } from "./run-loop";

// The engine runs here, off the main thread. No network access is made from this worker.
const scope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();

const post = (message: FromWorker): void => scope.postMessage(message);
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled.add(message.runId);
    return;
  }
  void runInChunks(
    message.runId,
    message.scenario,
    post,
    () => cancelled.has(message.runId),
    macrotask,
  ).finally(() => cancelled.delete(message.runId));
};
