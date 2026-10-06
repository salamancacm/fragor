import { compileDist } from "../core/distributions";
import type { EdgeSpec, FaultSpec } from "../model/types";
import { requireFraction, requireInteger, requireNonNegative, requirePositive } from "./validate";

export function validateEdge(e: EdgeSpec, nodeIds: ReadonlySet<string>): void {
  const p = `edges[${e.id}]`;
  if (!nodeIds.has(e.from)) throw new Error(`${p}.from references unknown node "${e.from}"`);
  if (!nodeIds.has(e.to)) throw new Error(`${p}.to references unknown node "${e.to}"`);
  compileDist(e.latency, `${p}.latency`);
  requireFraction(`${p}.packetLoss`, e.packetLoss);
  const { timeout, retry, circuitBreaker, bulkhead, fallback } = e.policies;
  if (timeout !== undefined) requirePositive(`${p}.policies.timeout.valueMs`, timeout.valueMs);
  if (retry !== undefined) {
    const r = `${p}.policies.retry`;
    if (retry.maxRetries !== -1) requireInteger(`${r}.maxRetries`, retry.maxRetries, 0);
    requireNonNegative(`${r}.delayMs`, retry.delayMs);
    requireNonNegative(`${r}.jitterMs`, retry.jitterMs);
    if (retry.maxDurationMs !== undefined)
      requireNonNegative(`${r}.maxDurationMs`, retry.maxDurationMs);
    if (retry.backoffFactor !== undefined) {
      if (!(retry.backoffFactor >= 1)) {
        throw new Error(`${r}.backoffFactor must be >= 1, got ${retry.backoffFactor}`);
      }
      const max = retry.maxDelayMs ?? 60_000;
      if (max > 0 && retry.delayMs >= max) {
        throw new Error(`${r}.delayMs (${retry.delayMs}) must be < maxDelayMs (${max})`);
      }
    }
    if (retry.maxDelayMs !== undefined) requireNonNegative(`${r}.maxDelayMs`, retry.maxDelayMs);
  }
  if (circuitBreaker !== undefined) {
    const c = `${p}.policies.circuitBreaker`;
    requireInteger(`${c}.requestVolumeThreshold`, circuitBreaker.requestVolumeThreshold, 1);
    requireFraction(`${c}.failureRatio`, circuitBreaker.failureRatio);
    requireNonNegative(`${c}.delayMs`, circuitBreaker.delayMs);
    requireInteger(`${c}.successThreshold`, circuitBreaker.successThreshold, 1);
  }
  if (bulkhead !== undefined) {
    requireInteger(`${p}.policies.bulkhead.value`, bulkhead.value, 1);
    if (bulkhead.waitingTaskQueue !== undefined) {
      requireInteger(`${p}.policies.bulkhead.waitingTaskQueue`, bulkhead.waitingTaskQueue, 0);
    }
  }
  if (fallback?.latency !== undefined)
    compileDist(fallback.latency, `${p}.policies.fallback.latency`);
}

const ALLOWED: Record<"node" | "edge" | "traffic", readonly string[]> = {
  node: ["latency-add", "latency-multiply", "error-rate", "outage", "capacity"],
  edge: ["latency-add", "latency-multiply", "packet-loss", "outage"],
  traffic: ["traffic-multiply"],
};

export function validateFault(
  f: FaultSpec,
  ids: { nodes: ReadonlySet<string>; edges: ReadonlySet<string>; traffic: ReadonlySet<string> },
): void {
  const p = `faults[${f.id}]`;
  requireNonNegative(`${p}.startMs`, f.startMs);
  requireNonNegative(`${p}.durationMs`, f.durationMs);
  const t = f.target;
  const [kind, id, known] =
    "node" in t
      ? (["node", t.node, ids.nodes] as const)
      : "edge" in t
        ? (["edge", t.edge, ids.edges] as const)
        : (["traffic", t.traffic, ids.traffic] as const);
  if (!known.has(id)) throw new Error(`${p}.target references unknown ${kind} "${id}"`);
  const e = f.effect;
  if (!ALLOWED[kind].includes(e.type)) {
    throw new Error(`${p}: effect "${e.type}" is not allowed for target kind "${kind}"`);
  }
  switch (e.type) {
    case "latency-add":
      compileDist(e.add, `${p}.effect.add`);
      return;
    case "latency-multiply":
    case "traffic-multiply":
      requireNonNegative(`${p}.effect.factor`, e.factor);
      return;
    case "capacity":
      requireNonNegative(`${p}.effect.workersFactor`, e.workersFactor);
      return;
    case "error-rate":
    case "packet-loss":
      requireFraction(`${p}.effect.rate`, e.rate);
      return;
    case "outage":
      if (e.mode !== "refuse" && e.mode !== "blackhole") {
        throw new Error(`${p}.effect.mode must be "refuse" or "blackhole"`);
      }
      return;
  }
}
