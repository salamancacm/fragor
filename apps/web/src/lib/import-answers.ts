import { DEFAULT_BREAKER, DEFAULT_RETRY, type PatchOp } from "@fragor/scenarios";

/**
 * Answers to the open questions of an import, as the typed patches the builder takes. Each kind of
 * question has its own small form; this module is what those forms mean, free of any UI.
 */

export type AnswerKind =
  | "workers"
  | "queueLimit"
  | "workerModel"
  | "serviceTime"
  | "timeout"
  | "retry"
  | "breaker"
  | "fallback";

export type Answer =
  | { kind: "workers"; value: number }
  | { kind: "queueLimit"; value: number | null }
  | { kind: "workerModel"; value: "blocking" | "async" }
  | { kind: "serviceTime"; p50Ms: number; p99Ms: number }
  | { kind: "timeout"; valueMs: number | null }
  | { kind: "retry"; retries: number }
  | { kind: "breaker"; on: boolean }
  | { kind: "fallback"; on: boolean };

const KIND_BY_PATH: [RegExp, AnswerKind][] = [
  [/^nodes\.[^.]+\.workers$/, "workers"],
  [/^nodes\.[^.]+\.queueLimit$/, "queueLimit"],
  [/^nodes\.[^.]+\.workerModel$/, "workerModel"],
  [/^nodes\.[^.]+\.serviceTime$/, "serviceTime"],
  [/^edges\.[^.]+\.policies\.timeout$/, "timeout"],
  [/^edges\.[^.]+\.policies\.retry$/, "retry"],
  [/^edges\.[^.]+\.policies\.circuitBreaker$/, "breaker"],
  [/^edges\.[^.]+\.policies\.fallback$/, "fallback"],
];

/** Which form answers the question about `path`; null for a path with no form. */
export function kindOf(path: string): AnswerKind | null {
  return KIND_BY_PATH.find(([re]) => re.test(path))?.[1] ?? null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The answer that describes what the scenario has now, to start the form from. */
export function initialAnswer(kind: AnswerKind, current: unknown): Answer {
  switch (kind) {
    case "workers":
      return { kind, value: typeof current === "number" ? current : 1 };
    case "queueLimit":
      return { kind, value: typeof current === "number" ? current : null };
    case "workerModel":
      return { kind, value: current === "async" ? "async" : "blocking" };
    case "serviceTime": {
      const c = isRecord(current) ? current : {};
      if (c.type === "lognormal" && typeof c.p50Ms === "number" && typeof c.p99Ms === "number")
        return { kind, p50Ms: c.p50Ms, p99Ms: c.p99Ms };
      const ms = typeof c.ms === "number" ? c.ms : 10;
      return { kind, p50Ms: ms, p99Ms: ms };
    }
    case "timeout":
      return {
        kind,
        valueMs: isRecord(current) && typeof current.valueMs === "number" ? current.valueMs : null,
      };
    case "retry":
      return {
        kind,
        retries:
          isRecord(current) && typeof current.maxRetries === "number" ? current.maxRetries : 0,
      };
    case "breaker":
      return { kind, on: current !== undefined && current !== null };
    case "fallback":
      return { kind, on: current !== undefined && current !== null };
  }
}

const isInt = (n: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  Number.isInteger(n) && n >= min && n <= max;

/** A message for what is wrong with an answer, or null when it can be applied. */
export function answerProblem(a: Answer): string | null {
  switch (a.kind) {
    case "workers":
      return isInt(a.value, 1) ? null : "Worker threads must be a whole number of at least 1.";
    case "queueLimit":
      return a.value === null || isInt(a.value, 0)
        ? null
        : "The queue size must be a whole number, or empty for no limit.";
    case "serviceTime":
      if (!(a.p50Ms > 0)) return "The median must be above 0 ms.";
      return a.p99Ms >= a.p50Ms ? null : "The p99 cannot be below the p50.";
    case "timeout":
      return a.valueMs === null || a.valueMs > 0
        ? null
        : "The timeout must be above 0 ms, or empty for none.";
    case "retry":
      return isInt(a.retries, 0, 100) ? null : "Retries must be a whole number from 0 to 100.";
    default:
      return null;
  }
}

/**
 * The patches that apply an answer. `current` is the value now at `path` in the draft: policies that
 * already exist keep their other settings (a retry's delay, a timeout's enforcement), and saying
 * "none" when there is none still closes the question (the builder treats it as an answer).
 */
export function answerOps(path: string, a: Answer, current: unknown): PatchOp[] {
  const set = (p: string, value: unknown): PatchOp => ({ op: "set", path: p, value });
  const exists = current !== undefined && current !== null;
  switch (a.kind) {
    case "workers":
    case "queueLimit":
    case "workerModel":
      return [set(path, a.kind === "workerModel" ? a.value : a.value)];
    case "serviceTime":
      return [set(path, { type: "lognormal", p50Ms: a.p50Ms, p99Ms: a.p99Ms })];
    case "timeout":
      if (a.valueMs === null) return [{ op: "unset", path }];
      return [exists ? set(`${path}.valueMs`, a.valueMs) : set(path, { valueMs: a.valueMs })];
    case "retry":
      if (a.retries === 0) return [{ op: "unset", path }];
      return [
        exists
          ? set(`${path}.maxRetries`, a.retries)
          : set(path, {
              maxRetries: a.retries,
              delayMs: DEFAULT_RETRY.delayMs,
              jitterMs: DEFAULT_RETRY.jitterMs,
            }),
      ];
    case "breaker":
      if (!a.on) return [{ op: "unset", path }];
      return [set(path, exists ? current : { ...DEFAULT_BREAKER })];
    case "fallback":
      if (!a.on) return [{ op: "unset", path }];
      return [set(path, exists ? current : { countsAs: "degraded" })];
  }
}
