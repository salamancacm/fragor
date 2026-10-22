import { ORIGINS, type Origin } from "./observed";

/** One parameter of the built scenario and where its value came from. */
export interface ReportEntry {
  /** Dotted path in the scenario, with items of nodes, edges and traffic addressed by id. */
  path: string;
  /** The value in the final scenario; null when the parameter is absent (e.g. no timeout). */
  value: unknown;
  origin: Origin;
  detail: string;
}

/** Something the data could not tell, for which a placeholder was used meanwhile. */
export interface Question {
  path: string;
  ask: string;
  /** Where to find it, e.g. a configuration key. */
  hint?: string;
  /** The placeholder in use. */
  assumed: unknown;
}

export interface ImportReport {
  version: 1;
  system: string;
  source: string;
  window: string;
  entries: ReportEntry[];
  /** Questions still open: no user edit has touched their path. */
  questions: Question[];
  /** Entries per origin. */
  counts: Record<Origin, number>;
  warnings: string[];
}

export function countByOrigin(entries: readonly ReportEntry[]): Record<Origin, number> {
  const counts = Object.fromEntries(ORIGINS.map((o) => [o, 0])) as Record<Origin, number>;
  for (const e of entries) counts[e.origin]++;
  return counts;
}

const show = (v: unknown): string => (v === null || v === undefined ? "none" : JSON.stringify(v));
const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The report as Markdown: what was measured, what is a placeholder, what to answer. */
export function renderReport(r: ImportReport): string {
  const total = r.entries.length;
  const lines = [
    `# Import report: ${r.system}`,
    "",
    `Source: ${r.source}. Observed window: ${r.window}.`,
    "",
    "## Summary",
    "",
    `${total} parameters: ${ORIGINS.map((o) => `${r.counts[o]} ${o}`).join(", ")}.`,
    r.counts.assumed > 0
      ? `**${r.counts.assumed} are placeholders** (assumed): the simulation uses them, but nothing observed supports them.`
      : "No parameter is a placeholder.",
    "",
  ];
  if (r.questions.length > 0) {
    lines.push("## Open questions", "");
    for (const q of r.questions) {
      lines.push(
        `- \`${q.path}\` (using ${show(q.assumed)}): ${q.ask}${q.hint === undefined ? "" : ` (${q.hint})`}`,
      );
    }
    lines.push("");
  }
  if (r.warnings.length > 0) {
    lines.push("## Warnings", "", ...r.warnings.map((w) => `- ${w}`), "");
  }
  lines.push(
    "## Parameters",
    "",
    "| Parameter | Value | Origin | Detail |",
    "| --- | --- | --- | --- |",
  );
  for (const e of r.entries) {
    lines.push(`| \`${e.path}\` | ${cell(show(e.value))} | ${e.origin} | ${cell(e.detail)} |`);
  }
  return `${lines.join("\n")}\n`;
}
