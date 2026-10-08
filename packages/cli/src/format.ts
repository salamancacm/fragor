import type { MetricDelta, ResultComparison, Scenario, SimulationResult } from "@fragor/engine";
import type { Finding } from "@fragor/scenarios";

export const HONESTY = "Simulation based on your assumptions, not a prediction.";

export function pct(n: number, of: number): string {
  return of === 0 ? "-" : `${((100 * n) / of).toFixed(1)}%`;
}

export function ms(v: number | null): string {
  if (v === null) return "-";
  return v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`;
}

/** Key/value lines with the values aligned in one left-aligned column. */
export function pairs(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join("\n");
}

/** Left-aligned first column, right-aligned others. */
export function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    for (const [i, cell] of row.entries()) widths[i] = Math.max(widths[i] ?? 0, cell.length);
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function formatRun(
  scenario: Scenario,
  r: SimulationResult,
  findings: readonly Finding[],
): string {
  const s = r.summary;
  const reasons = Object.entries(s.failureReasons)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const lines = [
    `Fragor · ${scenario.name} (seed ${scenario.seed})`,
    HONESTY,
    "",
    pairs([
      ["Roots", String(s.roots)],
      ["Success", pct(s.success, s.roots)],
      ["Degraded", pct(s.degraded, s.roots)],
      ["Failed", pct(s.failed, s.roots)],
      ["Unfinished", String(s.unfinished)],
      ["Goodput", `${s.goodputRps.toFixed(1)} rps`],
      [
        "Latency avg / p50 / p95 / p99",
        `${ms(s.avgLatencyMs)} / ${ms(s.p50Ms)} / ${ms(s.p95Ms)} / ${ms(s.p99Ms)}`,
      ],
      ["Attempts / retries / timeouts", `${s.attempts} / ${s.retries} / ${s.timeouts}`],
      ["Rejected 503", String(s.rejected503)],
      [
        "Circuit open / bulkhead full / fallbacks",
        `${s.circuitOpen} / ${s.bulkheadFull} / ${s.fallbacks}`,
      ],
      ["Orphaned work / responses", `${s.orphanedWork} / ${s.orphanedResponses}`],
      ["Discarded queued work", String(s.discardedWork)],
    ]),
    `Failure reasons (root cause): ${reasons === "" ? "none" : reasons}`,
    "",
    "By traffic source",
    table([
      ["source", "route", "roots", "success", "degraded", "failed", "p99"],
      ...scenario.traffic.map((t) => {
        const x = s.byTraffic[t.id];
        const roots = x?.roots ?? 0;
        return [
          t.id,
          t.route ?? "-",
          String(roots),
          pct(x?.success ?? 0, roots),
          pct(x?.degraded ?? 0, roots),
          pct(x?.failed ?? 0, roots),
          ms(x?.p99Ms ?? null),
        ];
      }),
    ]),
    "",
    findings.length === 0 ? "Findings: none" : `Findings (${findings.length})`,
    ...findings.map((f) => `  [${f.severity}] ${f.title}\n    ${f.summary}\n    id: ${f.id}`),
    "",
    `events ${r.stats.eventsProcessed} · wall clock ${r.stats.wallClockMs.toFixed(0)} ms · fingerprint ${r.fingerprint}`,
  ];
  return `${lines.join("\n")}\n`;
}

function value(m: MetricDelta, v: number | null): string {
  if (v === null) return "-";
  switch (m.unit) {
    case "ratio":
      return `${(v * 100).toFixed(1)}%`;
    case "ms":
      return ms(v);
    case "rps":
      return `${v.toFixed(1)} rps`;
    case "count":
      return String(v);
  }
}

function delta(m: MetricDelta): string {
  if (m.delta === null) return "-";
  const sign = m.delta > 0 ? "+" : "";
  switch (m.unit) {
    case "ratio":
      return `${sign}${(m.delta * 100).toFixed(1)} pp`;
    case "ms":
      return `${sign}${m.delta.toFixed(1)} ms`;
    case "rps":
      return `${sign}${m.delta.toFixed(1)}`;
    case "count":
      return `${sign}${m.delta}`;
  }
}

export function formatComparison(c: ResultComparison, labels: [string, string]): string {
  const lines = [
    `Fragor compare · before: ${labels[0]} (${c.before.scenarioName}, seed ${c.before.seed}) · after: ${labels[1]} (${c.after.scenarioName}, seed ${c.after.seed})`,
    HONESTY,
    "",
    table([
      ["metric", "before", "after", "delta", ""],
      ...c.metrics.map((m) => [
        m.label,
        value(m, m.before),
        value(m, m.after),
        delta(m),
        m.verdict === "n/a" || m.verdict === "same" ? "" : m.verdict,
      ]),
    ]),
  ];
  return `${lines.join("\n")}\n`;
}
