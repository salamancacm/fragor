import type { Scenario } from "@fragor/engine";
import type { z } from "zod";
import { checkReferences } from "./references";
import { scenarioObjectSchema } from "./schema";

/** A readable validation problem, e.g. `edges[order-payment].policies.timeout.valueMs`. */
export interface ValidationIssue {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; scenario: Scenario }
  | { ok: false; issues: ValidationIssue[] };

export class ScenarioValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `invalid scenario:\n${issues.map((i) => `  - ${i.path || "(root)"}: ${i.message}`).join("\n")}`,
    );
    this.name = "ScenarioValidationError";
  }
}

/** The full scenario schema: field rules plus cross references. */
export const scenarioSchema = scenarioObjectSchema.superRefine((s, ctx) => {
  for (const issue of checkReferences(s)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

const COLLECTIONS = new Set(["nodes", "edges", "traffic", "faults"]);

/**
 * Renders a Zod path, naming items of id'd collections by their id when available. The
 * collections are those of a scenario unless the caller gives its own (other formats, same idea).
 */
export function formatPath(
  path: readonly PropertyKey[],
  input: unknown,
  collections: ReadonlySet<string> = COLLECTIONS,
): string {
  let out = "";
  let cursor: unknown = input;
  let parentKey: PropertyKey | undefined;
  for (const key of path) {
    const next =
      isRecord(cursor) || Array.isArray(cursor)
        ? (cursor as Record<PropertyKey, unknown>)[key]
        : undefined;
    if (typeof key === "number") {
      const itemId = isRecord(next) && typeof next.id === "string" ? next.id : undefined;
      out +=
        collections.has(String(parentKey)) && itemId !== undefined ? `[${itemId}]` : `[${key}]`;
    } else {
      out += out === "" ? String(key) : `.${String(key)}`;
    }
    parentKey = key;
    cursor = next;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toIssues(error: z.ZodError, input: unknown): ValidationIssue[] {
  return error.issues.map((i) => ({ path: formatPath(i.path, input), message: i.message }));
}

/** Validates unknown input (e.g. parsed JSON) as a scenario without throwing. */
export function safeParseScenario(input: unknown): ParseResult {
  const result = scenarioSchema.safeParse(input);
  return result.success
    ? { ok: true, scenario: result.data }
    : { ok: false, issues: toIssues(result.error, input) };
}

/** Validates unknown input as a scenario; throws ScenarioValidationError with readable issues. */
export function parseScenario(input: unknown): Scenario {
  const result = safeParseScenario(input);
  if (!result.ok) throw new ScenarioValidationError(result.issues);
  return result.scenario;
}
