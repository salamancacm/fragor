import type { Origin, Sourced } from "./observed";
import type { Question, ReportEntry } from "./report";

/** Entries and open questions collected while the draft is built. */
export class Notes {
  readonly entries: ReportEntry[] = [];
  readonly questions: Question[] = [];

  add(path: string, value: unknown, s: { origin: Origin; detail: string }): void {
    this.entries.push({ path, value, origin: s.origin, detail: s.detail });
  }

  ask(path: string, ask: string, hint: string, assumed: unknown): void {
    this.questions.push({ path, ask, hint, assumed });
  }
}

/** The observed value, or a placeholder marked `assumed` when the data said nothing. */
export function orAssumed<T>(s: Sourced<T> | undefined, value: T, why: string): Sourced<T> {
  return s ?? { value, origin: "assumed", detail: why };
}
