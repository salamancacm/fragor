import type { FaultSpec, Scenario, SimulationResult } from "@fragor/engine";

/** Color role of a story element: failure, stress, recovery or degraded-but-served. */
export type Tone = "bad" | "warn" | "ok" | "deg";

/** A moment worth narrating, derived from the series of a run (display only). */
export interface FlowEvent {
  tMs: number;
  tone: Tone;
  title: string;
  detail: string;
  /** Node or edge id the event is about, for highlighting; null for global events. */
  ref: string | null;
}

/** Thresholds of the narration (display only; findings use their own rules). */
export const EVENT_THRESHOLDS = {
  saturated: 0.95,
  recovered: 0.8,
  retryStorm: 1.5,
  retryCalm: 1.2,
  usersFailing: 0.2,
  usersFine: 0.05,
} as const;

interface Run {
  on: number;
  off: number | null;
}

/** Bucket indexes where `on` starts holding and where `off` ends it (hysteresis). */
function runs(n: number, on: (i: number) => boolean, off: (i: number) => boolean): Run[] {
  const out: Run[] = [];
  let current: Run | null = null;
  for (let i = 0; i < n; i++) {
    if (current === null && on(i)) {
      current = { on: i, off: null };
      out.push(current);
    } else if (current !== null && off(i)) {
      current.off = i;
      current = null;
    }
  }
  return out;
}

const s = (ms: number) => `${+(ms / 1000).toFixed(2)} s`;

/** Human description of a fault effect, e.g. "+5 s on every call". */
export function describeEffect(f: FaultSpec): string {
  const e = f.effect;
  switch (e.type) {
    case "latency-add":
      return e.add.type === "constant" ? `+${s(e.add.ms)} on every call` : "extra latency on calls";
    case "latency-multiply":
      return `calls ${e.factor}× slower`;
    case "error-rate":
      return `${Math.round(e.rate * 100)}% of calls fail`;
    case "outage":
      return e.mode === "refuse" ? "down: connections refused" : "down: requests vanish";
    case "capacity":
      return `only ${Math.round(e.workersFactor * 100)}% of its workers`;
    case "packet-loss":
      return `${Math.round(e.rate * 100)}% packet loss`;
    case "traffic-multiply":
      return `traffic ×${e.factor}`;
  }
}

export function faultTargetName(scenario: Scenario, f: FaultSpec): string {
  const t = f.target;
  if ("node" in t) return scenario.nodes.find((n) => n.id === t.node)?.name ?? t.node;
  if ("edge" in t) {
    const e = scenario.edges.find((x) => x.id === t.edge);
    return e === undefined ? t.edge : `${nodeName(scenario, e.from)} → ${nodeName(scenario, e.to)}`;
  }
  return `traffic "${t.traffic}"`;
}

export const nodeName = (scenario: Scenario, id: string): string =>
  scenario.nodes.find((n) => n.id === id)?.name ?? id;

function faultEvents(scenario: Scenario): FlowEvent[] {
  return scenario.faults.flatMap((f) => {
    const who = faultTargetName(scenario, f);
    const ref = "node" in f.target ? f.target.node : "edge" in f.target ? f.target.edge : null;
    return [
      {
        tMs: f.startMs,
        tone: "warn" as const,
        title: `Fault: ${who}`,
        detail: `${describeEffect(f)}, for ${s(f.durationMs)}.`,
        ref,
      },
      {
        tMs: f.startMs + f.durationMs,
        tone: "ok" as const,
        title: `Fault over: ${who}`,
        detail: "Back to normal parameters.",
        ref,
      },
    ];
  });
}

function nodeEvents(scenario: Scenario, r: SimulationResult): FlowEvent[] {
  const { buckets, bucketMs } = r.series;
  const t = EVENT_THRESHOLDS;
  return scenario.nodes.flatMap((n) => {
    const x = r.series.nodes[n.id];
    if (x === undefined) return [];
    const util = (i: number) => x.utilization?.[i] ?? 0;
    const out: FlowEvent[] = [];
    for (const run of runs(
      buckets,
      (i) => util(i) >= t.saturated,
      (i) => util(i) < t.recovered,
    )) {
      out.push({
        tMs: run.on * bucketMs,
        tone: "bad",
        title: `${n.name} saturated`,
        detail: `All ${n.workers} workers busy: new requests wait in its queue.`,
        ref: n.id,
      });
      if (run.off !== null)
        out.push({
          tMs: run.off * bucketMs,
          tone: "ok",
          title: `${n.name} recovers`,
          detail: `Workers free again (${Math.round(util(run.off) * 100)}% busy).`,
          ref: n.id,
        });
    }
    const shed = (i: number) => x.rejected503[i] ?? 0;
    for (const run of runs(
      buckets,
      (i) => shed(i) > 0,
      (i) => shed(i) === 0,
    ))
      out.push({
        tMs: run.on * bucketMs,
        tone: "bad",
        title: `${n.name} sheds load`,
        detail: `Queue full (${n.queueLimit ?? "unbounded"}): ${shed(run.on)} requests rejected with 503 in that second.`,
        ref: n.id,
      });
    return out;
  });
}

function edgeEvents(scenario: Scenario, r: SimulationResult): FlowEvent[] {
  const { buckets, bucketMs } = r.series;
  const t = EVENT_THRESHOLDS;
  return scenario.edges.flatMap((e) => {
    const x = r.series.edges[e.id];
    if (x === undefined) return [];
    const route = `${nodeName(scenario, e.from)} → ${nodeName(scenario, e.to)}`;
    const amp = (i: number) => (x.attempts[i] ?? 0) / Math.max(1, x.arrivals[i] ?? 0);
    const out: FlowEvent[] = runs(
      buckets,
      (i) => amp(i) >= t.retryStorm,
      (i) => amp(i) < t.retryCalm,
    ).map((run) => ({
      tMs: run.on * bucketMs,
      tone: "warn",
      title: `Retry storm on ${route}`,
      detail: `Each call now makes ${amp(run.on).toFixed(1)} attempts: retries add load to a struggling service.`,
      ref: e.id,
    }));
    const full = (i: number) => x.bulkheadFull[i] ?? 0;
    for (const run of runs(
      buckets,
      (i) => full(i) > 0,
      (i) => full(i) === 0,
    ))
      out.push({
        tMs: run.on * bucketMs,
        tone: "deg",
        title: `Bulkhead on ${route} is full`,
        detail: `Extra calls are rejected at once instead of piling up: ${full(run.on)} in that second.`,
        ref: e.id,
      });
    const states = x.breakerState;
    if (states !== null)
      states.forEach((st, i) => {
        if (i === 0 || st === states[i - 1]) return;
        out.push({
          tMs: i * bucketMs,
          tone: st === "open" ? "deg" : st === "half-open" ? "warn" : "ok",
          title: `Circuit breaker ${st} on ${route}`,
          detail:
            st === "open"
              ? `Calls to ${nodeName(scenario, e.to)} stop at once${e.policies.fallback === undefined ? " and fail fast" : " and get the fallback"}.`
              : st === "half-open"
                ? "A few probe calls test whether the dependency recovered."
                : "The dependency answers again; calls flow normally.",
          ref: e.id,
        });
      });
    return out;
  });
}

function userEvents(r: SimulationResult): FlowEvent[] {
  const g = r.series.global;
  const t = EVENT_THRESHOLDS;
  const share = (i: number) => {
    const failed = g.failed[i] ?? 0;
    const done = (g.success[i] ?? 0) + (g.degraded[i] ?? 0) + failed;
    return done === 0 ? 0 : failed / done;
  };
  return runs(
    r.series.buckets,
    (i) => share(i) >= t.usersFailing,
    (i) => share(i) < t.usersFine,
  ).flatMap((run) => [
    {
      tMs: run.on * r.series.bucketMs,
      tone: "bad" as const,
      title: "Users see errors",
      detail: `${Math.round(share(run.on) * 100)}% of requests failing in that second.`,
      ref: null,
    },
    ...(run.off === null
      ? []
      : [
          {
            tMs: run.off * r.series.bucketMs,
            tone: "ok" as const,
            title: "Users served normally again",
            detail: `Failures back under ${t.usersFine * 100}%.`,
            ref: null,
          },
        ]),
  ]);
}

/** Every narrated event of a run, in time order (stable for equal times). */
export function deriveEvents(scenario: Scenario, r: SimulationResult): FlowEvent[] {
  return [
    ...faultEvents(scenario),
    ...nodeEvents(scenario, r),
    ...edgeEvents(scenario, r),
    ...userEvents(r),
  ]
    .map((e, k) => ({ e, k }))
    .sort((a, b) => a.e.tMs - b.e.tMs || a.k - b.k)
    .map(({ e }) => e);
}
