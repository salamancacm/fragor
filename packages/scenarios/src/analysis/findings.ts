import type { Scenario, SimulationResult } from "@fragor/engine";
import { singlePointOfFailure } from "./rules-graph";
import { cascadePropagation, saturationWindows, workerSaturation } from "./rules-load";
import { missingTimeout, orphanedWork, retryAmplification } from "./rules-policies";
import {
  DEFAULT_THRESHOLDS,
  type Finding,
  type FindingRule,
  type FindingThresholds,
  type Severity,
} from "./types";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const RULE_ORDER: Record<FindingRule, number> = {
  "cascade-propagation": 0,
  "worker-saturation": 1,
  "retry-amplification": 2,
  "orphaned-work": 3,
  "missing-timeout": 4,
  "single-point-of-failure": 5,
};

/**
 * Derives findings from a scenario and the result the engine computed for it. Deterministic and
 * rule-based (no AI): same inputs, same findings, in a stable order (severity, rule, id).
 */
export function deriveFindings(
  scenario: Scenario,
  result: SimulationResult,
  thresholds: Partial<FindingThresholds> = {},
): Finding[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const saturated = saturationWindows(result, t);
  const findings = [
    ...cascadePropagation(scenario, result, saturated),
    ...workerSaturation(scenario, result, saturated),
    ...retryAmplification(scenario, result, t),
    ...orphanedWork(scenario, result, t),
    ...missingTimeout(scenario, result, t),
    ...singlePointOfFailure(scenario, result, saturated),
  ];
  return findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      RULE_ORDER[a.rule] - RULE_ORDER[b.rule] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
