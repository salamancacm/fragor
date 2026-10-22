import type { Scenario } from "@fragor/engine";
import { applyPatch, type PatchOp, splitPath } from "@fragor/scenarios";
import type { Question, ReportEntry } from "./report";

const BY_ID = new Set(["nodes", "edges", "traffic", "faults"]);

/**
 * Value at a dotted path of a scenario (items of nodes, edges, traffic and faults by id, other
 * arrays by index), or undefined when there is nothing there.
 */
export function valueAt(scenario: Scenario, path: string): unknown {
  let cursor: unknown = scenario;
  let parentKey = "";
  for (const seg of path.split(".")) {
    if (Array.isArray(cursor)) {
      cursor = BY_ID.has(parentKey)
        ? cursor.find(
            (x) => typeof x === "object" && x !== null && (x as { id?: unknown }).id === seg,
          )
        : cursor[Number(seg)];
    } else if (typeof cursor === "object" && cursor !== null) {
      cursor = (cursor as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
    parentKey = seg;
  }
  return cursor;
}

/** Two paths overlap when one is the other or lies inside it (an edit of a part edits the whole). */
export function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

export type AppliedAnswers = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

/** Applies the user's edits (only set and unset) with the same typed patches as everywhere else. */
export function applyAnswers(scenario: Scenario, answers: readonly PatchOp[]): AppliedAnswers {
  const other = answers.find((a) => a.op !== "set" && a.op !== "unset");
  if (other !== undefined)
    return { ok: false, errors: [`answers may only set or unset values, not "${other.op}"`] };
  if (answers.length === 0) return { ok: true, scenario };
  try {
    return { ok: true, scenario: applyPatch(scenario, answers) };
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

function pathOf(op: PatchOp): string | null {
  return op.op === "set" || op.op === "unset" ? splitPath(op.path).join(".") : null;
}

const GIVEN = "given by the user";

/** The value to report at `path`: absent means "none", except a call's probability (always 1). */
function finalValue(scenario: Scenario, path: string): unknown {
  const v = valueAt(scenario, path);
  if (v !== undefined) return v;
  return path.endsWith(".probability") ? 1 : null;
}

/**
 * Brings the report in line with the final scenario: values are re-read, entries the user touched
 * become origin `user`, edits that match no entry are added, and answered questions are dropped.
 */
export function finalizeEntries(
  scenario: Scenario,
  entries: readonly ReportEntry[],
  questions: readonly Question[],
  answers: readonly PatchOp[],
): { entries: ReportEntry[]; questions: Question[] } {
  const touched = answers.map(pathOf).filter((p): p is string => p !== null);
  const out: ReportEntry[] = entries.map((e) => {
    if (!touched.some((p) => overlaps(p, e.path))) return { ...e, value: e.value ?? null };
    return { ...e, value: finalValue(scenario, e.path), origin: "user", detail: GIVEN };
  });
  for (const p of touched) {
    if (out.some((e) => overlaps(p, e.path))) continue;
    out.push({ path: p, value: finalValue(scenario, p), origin: "user", detail: GIVEN });
  }
  return {
    entries: out,
    questions: questions.filter((q) => !touched.some((p) => overlaps(p, q.path))),
  };
}
