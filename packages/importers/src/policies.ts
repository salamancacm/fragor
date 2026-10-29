import type { ClientPolicies } from "@fragor/engine";
import { DEFAULT_BREAKER, DEFAULT_RETRY } from "@fragor/scenarios";
import { type Notes, orAssumed } from "./notes";
import type { ObservedCall, Origin, Sourced } from "./observed";
import { HINTS } from "./placeholders";

type PolicyParts = Pick<ClientPolicies, "timeout" | "retry" | "circuitBreaker" | "fallback">;

/** Records one policy: its value (null when absent), its origin and, if unknown, the question. */
function note(
  notes: Notes,
  c: ObservedCall,
  policy: string,
  value: unknown,
  s: { origin: Origin; detail: string },
  question?: { ask: string; hint: string; assumed: unknown },
): void {
  const path = `edges.${c.id}.policies.${policy}`;
  notes.add(path, value ?? null, s);
  if (question !== undefined) notes.ask(path, question.ask, question.hint, question.assumed);
}

function timeoutPolicy(c: ObservedCall, notes: Notes): PolicyParts {
  const s = orAssumed<number | null>(
    c.timeoutMs,
    null,
    "not known: none modeled (the client read timeout, 30 s by default, applies)",
  );
  const timeout = s.value === null ? undefined : { valueMs: s.value };
  const route = `${c.from} → ${c.to}`;
  // An inferred timeout is what was seen (a timeout that fires late looks longer): confirm it.
  const ask =
    s.origin === "assumed"
      ? { ask: `Is there a timeout on ${route}?`, hint: HINTS.timeout, assumed: null }
      : s.origin === "inferred"
        ? {
            ask: `Is the timeout on ${route} really about ${s.value} ms?`,
            hint: HINTS.timeout,
            assumed: timeout,
          }
        : undefined;
  note(notes, c, "timeout", timeout, s, ask);
  return timeout === undefined ? {} : { timeout };
}

function retryPolicy(c: ObservedCall, notes: Notes): PolicyParts {
  const s = orAssumed(c.retries, 0, "not known: no retries modeled");
  const from = (x: Sourced<number> | undefined) =>
    x === undefined ? "SmallRye default" : `from ${x.origin}`;
  const retry =
    s.value > 0
      ? {
          maxRetries: s.value,
          delayMs: c.retryDelayMs?.value ?? DEFAULT_RETRY.delayMs,
          jitterMs: c.retryJitterMs?.value ?? DEFAULT_RETRY.jitterMs,
        }
      : undefined;
  const detail =
    retry === undefined
      ? s.detail
      : `${s.detail}; delay ${from(c.retryDelayMs)}, jitter ${from(c.retryJitterMs)}`;
  const route = `${c.from} → ${c.to}`;
  // Retries read from traces are a lower bound (the cap may never have been reached): confirm.
  const ask =
    s.origin === "assumed"
      ? { ask: `Does ${route} retry?`, hint: "@Retry maxRetries", assumed: null }
      : s.origin === "inferred"
        ? {
            ask: `How many retries does ${route} allow? At least ${s.value} were seen`,
            hint: "@Retry maxRetries",
            assumed: retry,
          }
        : undefined;
  note(notes, c, "retry", retry, { origin: s.origin, detail }, ask);
  return retry === undefined ? {} : { retry };
}

function breakerPolicy(c: ObservedCall, notes: Notes): PolicyParts {
  const s = orAssumed(c.breaker, false, "not known: no circuit breaker modeled");
  const circuitBreaker = s.value ? { ...DEFAULT_BREAKER } : undefined;
  const route = `${c.from} → ${c.to}`;
  const question =
    s.origin === "assumed"
      ? { ask: `Is there a circuit breaker on ${route}?`, hint: HINTS.breaker, assumed: null }
      : s.value
        ? {
            ask: `Which thresholds does the circuit breaker on ${route} use?`,
            hint: HINTS.breaker,
            assumed: DEFAULT_BREAKER,
          }
        : undefined;
  const detail = s.value ? `${s.detail}; thresholds are SmallRye defaults` : s.detail;
  note(notes, c, "circuitBreaker", circuitBreaker, { origin: s.origin, detail }, question);
  return circuitBreaker === undefined ? {} : { circuitBreaker };
}

function fallbackPolicy(c: ObservedCall, notes: Notes): PolicyParts {
  const s = orAssumed(c.fallback, false, "not known: no fallback modeled");
  const fallback = s.value ? { countsAs: "degraded" as const } : undefined;
  const detail = s.value ? `${s.detail}; its answers are counted as degraded (assumed)` : s.detail;
  const ask = {
    ask: `Is there a fallback on ${c.from} → ${c.to}?`,
    hint: HINTS.fallback,
    assumed: null,
  };
  note(
    notes,
    c,
    "fallback",
    fallback,
    { origin: s.origin, detail },
    s.origin === "assumed" ? ask : undefined,
  );
  return fallback === undefined ? {} : { fallback };
}

export function buildPolicies(c: ObservedCall, notes: Notes): ClientPolicies {
  return {
    ...timeoutPolicy(c, notes),
    ...retryPolicy(c, notes),
    ...breakerPolicy(c, notes),
    ...fallbackPolicy(c, notes),
  };
}
