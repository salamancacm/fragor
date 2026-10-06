import type { Ms } from "@fragor/engine";

export type FindingRule =
  | "worker-saturation"
  | "cascade-propagation"
  | "retry-amplification"
  | "orphaned-work"
  | "missing-timeout"
  | "single-point-of-failure";

export type Severity = "critical" | "warning" | "info";

/** What a finding points at, so explanations can cite concrete data instead of asserting. */
export type EvidenceTarget = { nodeId: string } | { edgeId: string } | { traceId: string };

export type Evidence = EvidenceTarget & {
  fromMs: Ms;
  toMs: Ms;
  /** Name of a result field: a Series key (e.g. "utilization"), a summary key or a graph fact. */
  metric: string;
  /** Aggregated value over [fromMs, toMs), or null for graph facts. */
  value: number | null;
};

/** A deterministic observation derived by rules from a scenario and its result. */
export interface Finding {
  /** Stable id: `${rule}:${target}`. */
  id: string;
  rule: FindingRule;
  severity: Severity;
  title: string;
  /** One or two sentences, built from computed numbers only. */
  summary: string;
  evidence: Evidence[];
}

/** Tunable thresholds of the rules; defaults in DEFAULT_THRESHOLDS. */
export interface FindingThresholds {
  /** Utilization considered saturated. */
  saturationUtilization: number;
  /** Minimum duration of a saturation run. */
  saturationMinMs: Ms;
  /** attempts / invocations at which retry amplification is a warning / critical. */
  amplificationWarning: number;
  amplificationCritical: number;
  /** orphaned work / completed jobs at which orphaned work is critical. */
  orphanedCriticalRatio: number;
  /** Edge p99 / effective timeout at which a missing timeout becomes a warning. */
  missingTimeoutP99Ratio: number;
}

export const DEFAULT_THRESHOLDS: FindingThresholds = {
  saturationUtilization: 0.95,
  saturationMinMs: 2000,
  amplificationWarning: 1.5,
  amplificationCritical: 2.5,
  orphanedCriticalRatio: 0.1,
  missingTimeoutP99Ratio: 0.5,
};
