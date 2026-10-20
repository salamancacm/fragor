import type { Scenario, SimulationResult, TrafficSpec } from "@fragor/engine";
import type { Finding } from "@fragor/scenarios";
import { describeEffect, faultTargetName, nodeName, type Tone } from "./events";

/** A piece of the headline; `tone` marks the numbers worth coloring. */
export interface StoryPart {
  text: string;
  tone: Tone | null;
}

const sec = (ms: number) => `${+(ms / 1000).toFixed(2)} s`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** What set things in motion: the first fault, else the most eventful traffic pattern. */
function trigger(scenario: Scenario): string {
  const f = [...scenario.faults].sort((a, b) => a.startMs - b.startMs)[0];
  if (f !== undefined) {
    const who = faultTargetName(scenario, f);
    const when = `from ${sec(f.startMs)} to ${sec(f.startMs + f.durationMs)}`;
    if (f.effect.type === "latency-add" && f.effect.add.type === "constant")
      return `${who} got ${sec(f.effect.add.ms)} slower ${when}.`;
    return `${who}: ${describeEffect(f)}, ${when}.`;
  }
  const spike = scenario.traffic.find(
    (t): t is TrafficSpec & { pattern: { type: "spike" } } => t.pattern.type === "spike",
  );
  if (spike !== undefined) {
    const p = spike.pattern;
    return `Traffic jumped from ${p.baseRps} to ${p.peakRps} req/s at ${sec(p.atMs)}, for ${sec(p.holdMs)}.`;
  }
  const ramp = scenario.traffic.find((t) => t.pattern.type === "ramp");
  if (ramp !== undefined && ramp.pattern.type === "ramp")
    return `Traffic ramped from ${ramp.pattern.fromRps} to ${ramp.pattern.toRps} req/s.`;
  const rps = scenario.traffic.reduce((a, t) => a + ("rps" in t.pattern ? t.pattern.rps : 0), 0);
  return `Steady traffic of ${rps} req/s.`;
}

/** How the system reacted, from the findings. */
function reaction(scenario: Scenario, findings: readonly Finding[]): string | null {
  const cascade = findings.find((f) => f.rule === "cascade-propagation");
  if (cascade !== undefined) {
    const chain = cascade.evidence
      .map((e) => ("nodeId" in e ? nodeName(scenario, e.nodeId) : null))
      .filter((x) => x !== null)
      .join(" → ");
    return cascade.severity === "critical"
      ? `Saturation climbed ${chain} up to the entry point`
      : `Saturation spread ${chain} but stopped before the entry point`;
  }
  const saturated = findings.filter((f) => f.rule === "worker-saturation");
  if (saturated.length > 0) {
    const names = saturated.flatMap((f) =>
      f.evidence.flatMap((e) => ("nodeId" in e ? [nodeName(scenario, e.nodeId)] : [])),
    );
    return `${[...new Set(names)].join(" and ")} ran out of workers`;
  }
  return null;
}

/** One-paragraph account of the run, built only from the scenario, its result and findings. */
export function storyOf(
  scenario: Scenario,
  r: SimulationResult,
  findings: readonly Finding[],
): StoryPart[] {
  const s = r.summary;
  const parts: StoryPart[] = [{ text: `${trigger(scenario)} `, tone: null }];
  const react = reaction(scenario, findings);
  if (react !== null) parts.push({ text: `${react}, `, tone: null });
  if (s.roots === 0) return [...parts, { text: "and no request arrived.", tone: null }];
  if (s.failed > 0) {
    parts.push({ text: react === null ? "In total " : "and ", tone: null });
    parts.push({ text: `${pct(s.failed / s.roots)} of requests failed`, tone: "bad" });
  } else {
    parts.push({ text: react === null ? "In the end " : "but ", tone: null });
    parts.push({ text: "no request failed", tone: "ok" });
  }
  if (s.degraded > 0) {
    parts.push({ text: s.failed > 0 ? "; " : ": ", tone: null });
    parts.push({ text: `${pct(s.degraded / s.roots)} were served by a fallback`, tone: "deg" });
  }
  parts.push({ text: ".", tone: null });
  return parts;
}
