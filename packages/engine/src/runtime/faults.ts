import { compileDist, type Sampler } from "../core/distributions";
import type { FaultEffect, FaultSpec, FaultTarget, Ms } from "../model/types";
import type { Scheduler } from "./scheduler";

export interface LatencyEffects {
  /** One sampler per active latency-add fault; their samples are summed. */
  readonly add: readonly Sampler[];
  /** Product of the active latency-multiply factors. */
  readonly factor: number;
}

export interface NodeEffects extends LatencyEffects {
  /** errorRate override from the most recently started error-rate fault, if any. */
  readonly errorRate: number | null;
  readonly outage: "refuse" | "blackhole" | null;
  /** Product of the active capacity factors. */
  readonly workersFactor: number;
}

export interface EdgeEffects extends LatencyEffects {
  /** Extra packet-loss rates, combined with the edge's own as independent losses. */
  readonly lossRates: readonly number[];
  readonly outage: "refuse" | "blackhole" | null;
}

interface Active {
  readonly spec: FaultSpec;
  readonly order: number;
  readonly sampler: Sampler | null;
}

const NONE: NodeEffects = {
  add: [],
  factor: 1,
  errorRate: null,
  outage: null,
  workersFactor: 1,
};
const NO_EDGE: EdgeEffects = { add: [], factor: 1, lossRates: [], outage: null };

export function targetKey(t: FaultTarget): string {
  if ("node" in t) return `node:${t.node}`;
  if ("edge" in t) return `edge:${t.edge}`;
  return `traffic:${t.traffic}`;
}

/**
 * Activates and deactivates faults (FAULT_START / FAULT_END) and exposes the combined effect per
 * target. Combination: latency-add sums, latency-multiply / capacity / traffic-multiply multiply,
 * error-rate: the most recently started wins, outage: blackhole wins over refuse, packet-loss:
 * independent losses.
 */
export class FaultRegistry {
  private readonly active = new Map<string, Active[]>();
  private readonly listeners = new Map<string, (() => void)[]>();
  private readonly nodeCache = new Map<string, NodeEffects>();
  private readonly edgeCache = new Map<string, EdgeEffects>();
  private readonly trafficCache = new Map<string, number>();
  private startOrder = 0;

  constructor(
    faults: readonly FaultSpec[],
    private readonly scheduler: Scheduler,
    private readonly onPhase: (id: string, phase: "start" | "end", atMs: Ms) => void,
  ) {
    for (const spec of faults) {
      const sampler = compileLatency(spec.effect, `faults[${spec.id}].effect.add`);
      scheduler.schedule(spec.startMs, "FAULT_START", () => this.start(spec, sampler));
      scheduler.schedule(spec.startMs + spec.durationMs, "FAULT_END", () => this.end(spec));
    }
  }

  subscribe(target: FaultTarget, listener: () => void): void {
    const key = targetKey(target);
    const list = this.listeners.get(key) ?? [];
    list.push(listener);
    this.listeners.set(key, list);
  }

  node(id: string): NodeEffects {
    return this.nodeCache.get(id) ?? NONE;
  }

  edge(id: string): EdgeEffects {
    return this.edgeCache.get(id) ?? NO_EDGE;
  }

  trafficFactor(id: string): number {
    return this.trafficCache.get(id) ?? 1;
  }

  private start(spec: FaultSpec, sampler: Sampler | null): void {
    const key = targetKey(spec.target);
    const list = this.active.get(key) ?? [];
    list.push({ spec, order: this.startOrder++, sampler });
    this.active.set(key, list);
    this.changed(spec, "start");
  }

  private end(spec: FaultSpec): void {
    const key = targetKey(spec.target);
    this.active.set(
      key,
      (this.active.get(key) ?? []).filter((a) => a.spec !== spec),
    );
    this.changed(spec, "end");
  }

  private changed(spec: FaultSpec, phase: "start" | "end"): void {
    const key = targetKey(spec.target);
    const list = this.active.get(key) ?? [];
    const t = spec.target;
    if ("node" in t) this.nodeCache.set(t.node, combineNode(list));
    else if ("edge" in t) this.edgeCache.set(t.edge, combineEdge(list));
    else this.trafficCache.set(t.traffic, product(list, "traffic-multiply"));
    this.onPhase(spec.id, phase, this.scheduler.nowMs);
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
}

function compileLatency(effect: FaultEffect, path: string): Sampler | null {
  return effect.type === "latency-add" ? compileDist(effect.add, path) : null;
}

function product(list: readonly Active[], type: FaultEffect["type"]): number {
  let p = 1;
  for (const { spec } of list) {
    const e = spec.effect;
    if (e.type !== type) continue;
    if (e.type === "latency-multiply" || e.type === "traffic-multiply") p *= e.factor;
    else if (e.type === "capacity") p *= e.workersFactor;
  }
  return p;
}

function latency(list: readonly Active[]): LatencyEffects {
  const add: Sampler[] = [];
  for (const a of list) if (a.sampler !== null) add.push(a.sampler);
  return { add, factor: product(list, "latency-multiply") };
}

function outage(list: readonly Active[]): "refuse" | "blackhole" | null {
  let mode: "refuse" | "blackhole" | null = null;
  for (const { spec } of list) {
    if (spec.effect.type !== "outage") continue;
    if (spec.effect.mode === "blackhole") return "blackhole";
    mode = "refuse";
  }
  return mode;
}

function combineNode(list: readonly Active[]): NodeEffects {
  let errorRate: number | null = null;
  let latest = -1;
  for (const a of list) {
    if (a.spec.effect.type === "error-rate" && a.order > latest) {
      latest = a.order;
      errorRate = a.spec.effect.rate;
    }
  }
  return {
    ...latency(list),
    errorRate,
    outage: outage(list),
    workersFactor: product(list, "capacity"),
  };
}

function combineEdge(list: readonly Active[]): EdgeEffects {
  const lossRates: number[] = [];
  for (const { spec } of list)
    if (spec.effect.type === "packet-loss") lossRates.push(spec.effect.rate);
  return { ...latency(list), lossRates, outage: outage(list) };
}
