import { formatPath } from "@fragor/scenarios";
import { z } from "zod";

/**
 * What a running system showed, in a form independent of where it was read from (traces, metrics,
 * configuration, a person). Every value says where it came from, so a scenario built from it can
 * show which numbers are measured and which are placeholders.
 */

/** Where a value comes from. */
export type Origin = "observed" | "inferred" | "config" | "user" | "assumed";

export const ORIGINS: readonly Origin[] = ["observed", "inferred", "config", "user", "assumed"];

export interface Sourced<T> {
  value: T;
  origin: Origin;
  /** How it was obtained: the query, the rule applied, the file and key, or why it is a guess. */
  detail: string;
}

/** Response time summarized by its median and 99th percentile (what a lognormal needs). */
export interface LatencyQuantiles {
  p50Ms: number;
  p99Ms: number;
}

export interface ObservedService {
  /** Stable id (no dots or whitespace); becomes the node id. */
  id: string;
  name: string;
  kind: "service" | "external-api";
  /** Worker threads handling requests. */
  workers?: Sourced<number>;
  /** Requests that may wait for a worker; null = unbounded. */
  queueLimit?: Sourced<number | null>;
  /** blocking: a thread waits for its dependencies; async: it is released meanwhile. */
  workerModel?: Sourced<"blocking" | "async">;
  /** Own processing time, without waiting for dependencies. */
  serviceTime?: Sourced<LatencyQuantiles>;
  /** Share of requests this service answers with an error by itself, 0..1. */
  errorRate?: Sourced<number>;
}

export interface ObservedCall {
  /** Stable id; becomes the edge id. */
  id: string;
  from: string;
  to: string;
  /** Share of the caller's requests that make this call, 0..1. */
  probability?: Sourced<number>;
  /** One-way network latency between the two. */
  networkMs?: Sourced<number>;
  /** Attempt timeout; null = there is none (the client default applies). */
  timeoutMs?: Sourced<number | null>;
  /** Retries after the first attempt; 0 = none. */
  retries?: Sourced<number>;
  /** Wait between retries. */
  retryDelayMs?: Sourced<number>;
  /** Random extra wait added to each retry delay. */
  retryJitterMs?: Sourced<number>;
  /** Whether a circuit breaker guards the call. */
  breaker?: Sourced<boolean>;
  /** Whether a fallback answers when the call fails. */
  fallback?: Sourced<boolean>;
}

export interface ObservedTraffic {
  id: string;
  /** Id of the service that receives it. */
  target: string;
  rps: Sourced<number>;
  /** How requests arrive: evenly spaced (constant) or at random (poisson, the default). */
  arrivals?: Sourced<"constant" | "poisson">;
}

export interface ObservedSystem {
  version: 1;
  name: string;
  /** Where the data was read from, e.g. "otlp-traces: traces.jsonl". */
  source: string;
  window: {
    /** What the observed window was, e.g. "2026-10-22 14:00-15:00 UTC". */
    description: string;
    /** Length of the observed window. */
    durationMs: number;
  };
  services: ObservedService[];
  calls: ObservedCall[];
  traffic: ObservedTraffic[];
}

const originSchema = z
  .enum(["observed", "inferred", "config", "user", "assumed"])
  .describe(
    "Where the value comes from: observed (measured), inferred (derived by a stated rule), config (read from configuration), user (given by a person), assumed (a placeholder).",
  );

const sourced = <S extends z.ZodType>(value: S, what: string) =>
  z
    .strictObject({
      value: value.description === undefined ? value.describe(what) : value,
      origin: originSchema,
      detail: z.string().min(1).describe("How the value was obtained, or why it is a guess."),
    })
    .describe(what);

const id = (what: string) =>
  z
    .string()
    .min(1)
    .regex(/^[^.\s]+$/, "ids must not be empty, contain dots or whitespace")
    .describe(`Stable identifier of the ${what}. No dots or whitespace.`);

const ms = (what: string) => z.number().min(0).describe(`${what}, in milliseconds (>= 0).`);
const fraction = (what: string) =>
  z.number().min(0).max(1).describe(`${what}, a fraction in 0..1.`);

const quantilesSchema = z
  .strictObject({
    p50Ms: z.number().gt(0).describe("Median, in milliseconds (> 0)."),
    p99Ms: z.number().gt(0).describe("99th percentile, in milliseconds; must be >= p50Ms."),
  })
  .refine((q) => q.p99Ms >= q.p50Ms, { message: "p99Ms must be >= p50Ms", path: ["p99Ms"] })
  .describe("Response time summarized by median and 99th percentile.");

const serviceSchema = z
  .strictObject({
    id: id("service"),
    name: z.string().min(1).describe("Display name."),
    kind: z
      .enum(["service", "external-api"])
      .describe("service: runs on workers you control; external-api: someone else's."),
    workers: sourced(
      z.number().int().min(1),
      "Worker threads handling requests (integer >= 1).",
    ).exactOptional(),
    queueLimit: sourced(
      z.number().int().min(0).nullable(),
      "Requests that may wait for a worker (integer >= 0); null means unbounded.",
    ).exactOptional(),
    workerModel: sourced(
      z.enum(["blocking", "async"]),
      "blocking: a thread waits for its dependencies; async: it is released meanwhile.",
    ).exactOptional(),
    serviceTime: sourced(
      quantilesSchema,
      "Own processing time, without waiting for dependencies.",
    ).exactOptional(),
    errorRate: sourced(
      fraction("Share of requests the service answers with an error by itself"),
      "Own error rate.",
    ).exactOptional(),
  })
  .describe("A service or external API seen in the system.");

const callSchema = z
  .strictObject({
    id: id("call (it becomes the edge id)"),
    from: id("calling service"),
    to: id("called service"),
    probability: sourced(
      fraction("Share of the caller's requests that make this call"),
      "How often the call is made.",
    ).exactOptional(),
    networkMs: sourced(ms("One-way network latency"), "Network latency.").exactOptional(),
    timeoutMs: sourced(
      z.number().gt(0).nullable(),
      "Attempt timeout in milliseconds (> 0); null means there is none.",
    ).exactOptional(),
    retries: sourced(
      z.number().int().min(0).max(100),
      "Retries after the first attempt (integer, 0 to 100); 0 means none.",
    ).exactOptional(),
    retryDelayMs: sourced(ms("Wait between retries"), "Retry delay.").exactOptional(),
    retryJitterMs: sourced(
      ms("Random extra wait added to each retry delay"),
      "Retry jitter.",
    ).exactOptional(),
    breaker: sourced(z.boolean(), "Whether a circuit breaker guards the call.").exactOptional(),
    fallback: sourced(
      z.boolean(),
      "Whether a fallback answers when the call fails.",
    ).exactOptional(),
  })
  .describe("A call from one service to another.");

const trafficSchema = z
  .strictObject({
    id: id("traffic source"),
    target: id("service that receives it"),
    rps: sourced(z.number().min(0), "Requests per second arriving at the target (>= 0)."),
    arrivals: sourced(
      z.enum(["constant", "poisson"]),
      "How requests arrive: evenly spaced (constant) or at random (poisson); poisson when absent.",
    ).exactOptional(),
  })
  .describe("Traffic entering the system at a service.");

export const observedSystemSchema = z
  .strictObject({
    version: z.literal(1).describe("Format version of the observed system."),
    name: z.string().min(1).describe("Name of the system."),
    source: z.string().min(1).describe("Where the data was read from."),
    window: z
      .strictObject({
        description: z.string().min(1).describe("What the observed window was."),
        durationMs: z
          .number()
          .gt(0)
          .describe("Length of the observed window, in milliseconds (> 0)."),
      })
      .describe("The period that was observed."),
    services: z.array(serviceSchema).min(1).describe("Services and external APIs."),
    calls: z.array(callSchema).describe("Calls between services."),
    traffic: z.array(trafficSchema).min(1).describe("Traffic entering the system."),
  })
  .describe(
    "What a running system showed (traces, metrics, configuration), with the origin of every value, from which Fragor builds a draft scenario.",
  ) satisfies z.ZodType<ObservedSystem>;

/** Problems the field schemas cannot express: duplicate ids and references to missing services. */
export function checkObserved(o: ObservedSystem): string[] {
  const problems: string[] = [];
  for (const key of ["services", "calls", "traffic"] as const) {
    const seen = new Set<string>();
    for (const item of o[key]) {
      if (seen.has(item.id)) problems.push(`${key}[${item.id}].id: duplicate id "${item.id}"`);
      seen.add(item.id);
    }
  }
  const services = new Set(o.services.map((s) => s.id));
  for (const c of o.calls) {
    if (!services.has(c.from)) problems.push(`calls[${c.id}].from: unknown service "${c.from}"`);
    if (!services.has(c.to)) problems.push(`calls[${c.id}].to: unknown service "${c.to}"`);
  }
  for (const t of o.traffic) {
    if (!services.has(t.target))
      problems.push(`traffic[${t.id}].target: unknown service "${t.target}"`);
  }
  return problems;
}

const COLLECTIONS: ReadonlySet<string> = new Set(["services", "calls", "traffic"]);

export type ParseObservedResult =
  | { ok: true; observed: ObservedSystem }
  | { ok: false; errors: string[] };

/** Validates unknown input (a file, a pasted JSON) as an observed system, naming each problem. */
export function parseObserved(input: unknown): ParseObservedResult {
  const r = observedSystemSchema.safeParse(input);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map(
        (i) => `${formatPath(i.path, input, COLLECTIONS) || "(root)"}: ${i.message}`,
      ),
    };
  }
  const problems = checkObserved(r.data);
  return problems.length === 0 ? { ok: true, observed: r.data } : { ok: false, errors: problems };
}
