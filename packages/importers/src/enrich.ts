import type { Guard, ServiceMetrics } from "./metrics";
import type { ObservedCall, ObservedSystem, Sourced } from "./observed";

export interface ServiceInput {
  /** Id of the service the metrics were read from. */
  service: string;
  metrics: ServiceMetrics;
}

export interface Enriched {
  observed: ObservedSystem;
  warnings: string[];
}

/** A measured rate replaces any earlier value except one a person gave. */
const replaceable = (s: Sourced<unknown> | undefined) => s === undefined || s.origin !== "user";

/** A policy the metrics only hint at replaces a guess, never something read or given. */
const guessed = (s: Sourced<unknown> | undefined) =>
  s === undefined || s.origin === "assumed" || s.origin === "inferred";

/** Relative difference past which a measured rate disagrees with what was there before. */
const DISAGREES = 0.15;

const round = (n: number) => +n.toFixed(1);

function applyTraffic(
  out: ObservedSystem,
  { service, metrics }: ServiceInput,
  warnings: string[],
): void {
  for (const t of out.traffic.filter((x) => x.target === service)) {
    if (!replaceable(t.rps)) continue;
    const rps = metrics.server.rps;
    const was = t.rps.value;
    if (was > 0 && Math.abs(rps - was) / was > DISAGREES)
      warnings.push(
        `Traffic into ${service}: the counters show ${round(rps)} req/s, but ${t.rps.origin} gave ${round(was)}` +
          (t.rps.origin === "inferred" ? " (the traces may be sampled)." : "."),
      );
    t.rps = {
      value: rps,
      origin: "observed",
      detail: `rate of http_server_requests_seconds_count of ${service} over ${round(metrics.seconds)} s`,
    };
  }
}

function breaker(g: Guard): Sourced<boolean> {
  return g.circuitBreaker
    ? {
        value: true,
        origin: "observed",
        detail: `ft_circuitbreaker_* series exist for ${g.method}`,
      }
    : {
        value: false,
        origin: "inferred",
        detail: `ft_invocations_total exists for ${g.method} but no ft_circuitbreaker_* series`,
      };
}

function fallback(g: Guard): Sourced<boolean> {
  return g.fallback === "defined"
    ? {
        value: true,
        origin: "observed",
        detail: `ft_invocations_total{fallback} of ${g.method} is applied or notApplied: a fallback is defined`,
      }
    : {
        value: false,
        origin: "observed",
        detail: `ft_invocations_total{fallback="notDefined"} for ${g.method}: no fallback`,
      };
}

/** Sets a policy flag from the metrics, or warns when it contradicts what is already known. */
function settle(
  call: ObservedCall,
  field: "breaker" | "fallback",
  seen: Sourced<boolean>,
  warnings: string[],
): void {
  const known = call[field];
  if (guessed(known)) call[field] = seen;
  else if (known !== undefined && known.value !== seen.value)
    warnings.push(
      `${call.from} → ${call.to}: ${known.origin} says ${field}=${known.value}, the metrics say ${seen.value} (${seen.detail}).`,
    );
}

function applyGuards(
  out: ObservedSystem,
  { service, metrics }: ServiceInput,
  warnings: string[],
): void {
  if (metrics.guards.length === 0) return;
  const calls = out.calls.filter((c) => c.from === service);
  const only = calls[0];
  const guard = metrics.guards[0];
  if (
    only === undefined ||
    guard === undefined ||
    calls.length !== 1 ||
    metrics.guards.length !== 1
  ) {
    warnings.push(
      `${service} has ${metrics.guards.length} guarded method(s) and ${calls.length} calls: ` +
        "the metrics do not say which method makes which call, so the breaker and fallback are not set from them.",
    );
    return;
  }
  settle(only, "breaker", breaker(guard), warnings);
  settle(only, "fallback", fallback(guard), warnings);
}

/**
 * Refines an observed system with what services' own metrics say: the traffic they received and
 * whether their calls are guarded by a circuit breaker or a fallback. Returns a copy: the measured
 * traffic replaces what was there (except what a person gave), while breaker and fallback only
 * replace guesses and are reported when they contradict something read or given.
 */
export function applyMetrics(observed: ObservedSystem, inputs: readonly ServiceInput[]): Enriched {
  // An observed system is plain JSON, so a round trip is a deep copy.
  const out: ObservedSystem = JSON.parse(JSON.stringify(observed));
  const warnings: string[] = [];
  for (const input of inputs) {
    if (!out.services.some((s) => s.id === input.service)) {
      warnings.push(
        `The metrics are for "${input.service}", which is not one of the services (${out.services.map((s) => s.id).join(", ")}).`,
      );
      continue;
    }
    if (input.metrics.sinceStart)
      warnings.push(
        `The metrics of ${input.service} cover everything since the service started (${round(input.metrics.seconds)} s), ` +
          "not a window: use two snapshots to measure a period.",
      );
    applyTraffic(out, input, warnings);
    applyGuards(out, input, warnings);
  }
  return { observed: out, warnings };
}
