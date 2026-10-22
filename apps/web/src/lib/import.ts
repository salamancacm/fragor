import type { Scenario } from "@fragor/engine";
import { safeParseScenario } from "@fragor/scenarios";

export type ReadResult = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

/** Larger inputs are refused before parsing (a scenario is a few KB). */
export const MAX_SCENARIO_BYTES = 2_000_000;

/** Line and column (1-based) of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

function jsonError(text: string, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/line \d+ column \d+/.test(message)) return `Not valid JSON: ${message}`;
  const at = /position (\d+)/.exec(message);
  if (at?.[1] === undefined) return `Not valid JSON: ${message}`;
  const { line, column } = lineColumn(text, Number(at[1]));
  return `Not valid JSON (line ${line}, column ${column}): ${message}`;
}

/**
 * Reads a scenario pasted or uploaded by the user: JSON syntax first, then the scenario schema
 * (the same one the CLI uses), with errors naming the field, e.g. `nodes[api].workers: ...`.
 */
export function readScenario(text: string): ReadResult {
  if (text.trim() === "") return { ok: false, errors: ["Paste a scenario or choose a file."] };
  if (text.length > MAX_SCENARIO_BYTES)
    return {
      ok: false,
      errors: [`Too large (${text.length} characters); a scenario is a few KB.`],
    };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [jsonError(text, e)] };
  }
  const r = safeParseScenario(raw);
  if (r.ok) return r;
  return { ok: false, errors: r.issues.map((i) => `${i.path || "(root)"}: ${i.message}`) };
}

/** Pretty JSON of a scenario, ready to save or edit. */
export function scenarioJson(s: Scenario): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
