import type { SimulationResult, SimulationSummary } from "../model/types";

export type MetricUnit = "count" | "ratio" | "ms" | "rps";

export interface MetricDelta {
  key: string;
  label: string;
  unit: MetricUnit;
  before: number | null;
  after: number | null;
  /** after - before; null when either side is null. */
  delta: number | null;
  /** Direction that is an improvement; "neither" for context metrics like roots. */
  betterWhen: "lower" | "higher" | "neither";
  verdict: "better" | "worse" | "same" | "n/a";
}

export interface ResultComparison {
  comparisonVersion: 1;
  before: { scenarioName: string; seed: number; fingerprint: string };
  after: { scenarioName: string; seed: number; fingerprint: string };
  metrics: MetricDelta[];
}

interface MetricDef {
  key: string;
  label: string;
  unit: MetricUnit;
  betterWhen: MetricDelta["betterWhen"];
  read: (s: SimulationSummary) => number | null;
}

const rate = (n: number, s: SimulationSummary): number | null =>
  s.roots === 0 ? null : n / s.roots;

const METRICS: readonly MetricDef[] = [
  { key: "roots", label: "Roots", unit: "count", betterWhen: "neither", read: (s) => s.roots },
  {
    key: "successRate",
    label: "Success",
    unit: "ratio",
    betterWhen: "higher",
    read: (s) => rate(s.success, s),
  },
  {
    key: "degradedRate",
    label: "Degraded",
    unit: "ratio",
    betterWhen: "lower",
    read: (s) => rate(s.degraded, s),
  },
  {
    key: "failedRate",
    label: "Failed",
    unit: "ratio",
    betterWhen: "lower",
    read: (s) => rate(s.failed, s),
  },
  {
    key: "unfinished",
    label: "Unfinished",
    unit: "count",
    betterWhen: "lower",
    read: (s) => s.unfinished,
  },
  {
    key: "goodputRps",
    label: "Goodput",
    unit: "rps",
    betterWhen: "higher",
    read: (s) => s.goodputRps,
  },
  {
    key: "avgLatencyMs",
    label: "Avg latency",
    unit: "ms",
    betterWhen: "lower",
    read: (s) => s.avgLatencyMs,
  },
  { key: "p50Ms", label: "p50", unit: "ms", betterWhen: "lower", read: (s) => s.p50Ms },
  { key: "p95Ms", label: "p95", unit: "ms", betterWhen: "lower", read: (s) => s.p95Ms },
  { key: "p99Ms", label: "p99", unit: "ms", betterWhen: "lower", read: (s) => s.p99Ms },
  {
    key: "attempts",
    label: "Attempts",
    unit: "count",
    betterWhen: "lower",
    read: (s) => s.attempts,
  },
  { key: "retries", label: "Retries", unit: "count", betterWhen: "lower", read: (s) => s.retries },
  {
    key: "timeouts",
    label: "Timeouts",
    unit: "count",
    betterWhen: "lower",
    read: (s) => s.timeouts,
  },
  {
    key: "timeoutsLost",
    label: "Timeouts lost",
    unit: "count",
    betterWhen: "lower",
    read: (s) => s.timeoutsLost,
  },
  {
    key: "rejected503",
    label: "Rejected 503",
    unit: "count",
    betterWhen: "lower",
    read: (s) => s.rejected503,
  },
  {
    key: "circuitOpen",
    label: "Circuit open",
    unit: "count",
    betterWhen: "neither",
    read: (s) => s.circuitOpen,
  },
  {
    key: "bulkheadFull",
    label: "Bulkhead full",
    unit: "count",
    betterWhen: "neither",
    read: (s) => s.bulkheadFull,
  },
  {
    key: "fallbacks",
    label: "Fallbacks",
    unit: "count",
    betterWhen: "neither",
    read: (s) => s.fallbacks,
  },
  {
    key: "orphanedWork",
    label: "Orphaned work",
    unit: "count",
    betterWhen: "lower",
    read: (s) => s.orphanedWork,
  },
  {
    key: "orphanedResponses",
    label: "Orphaned responses",
    unit: "count",
    betterWhen: "lower",
    read: (s) => s.orphanedResponses,
  },
];

function verdict(def: MetricDef, delta: number | null): MetricDelta["verdict"] {
  if (delta === null || def.betterWhen === "neither") return "n/a";
  if (delta === 0) return "same";
  return delta < 0 === (def.betterWhen === "lower") ? "better" : "worse";
}

/**
 * Before/after comparison of two results: the core "what changed" view of the product.
 * Pure and JSON-only, shared by the CLI and the UI. Rates are fractions of roots.
 */
export function compareResults(
  before: SimulationResult,
  after: SimulationResult,
): ResultComparison {
  const ref = (r: SimulationResult) => ({
    scenarioName: r.scenarioName,
    seed: r.seed,
    fingerprint: r.fingerprint,
  });
  return {
    comparisonVersion: 1,
    before: ref(before),
    after: ref(after),
    metrics: METRICS.map((def) => {
      const b = def.read(before.summary);
      const a = def.read(after.summary);
      const delta = a === null || b === null ? null : a - b;
      return {
        key: def.key,
        label: def.label,
        unit: def.unit,
        before: b,
        after: a,
        delta,
        betterWhen: def.betterWhen,
        verdict: verdict(def, delta),
      };
    }),
  };
}
