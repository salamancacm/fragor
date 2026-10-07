import type {
  BulkheadPolicy,
  CallSpec,
  CircuitBreakerPolicy,
  ClientPolicies,
  Dist,
  EdgeSpec,
  FailureKind,
  FallbackPolicy,
  FaultEffect,
  FaultSpec,
  FaultTarget,
  NodeSpec,
  RetryPolicy,
  Scenario,
  TimeoutPolicy,
  TrafficPattern,
  TrafficSpec,
} from "@fragor/engine";
import { z } from "zod";

/**
 * Zod schemas for a Fragor scenario. The engine types (@fragor/engine model/types.ts) are the
 * source of truth: every schema is declared `satisfies z.ZodType<T>` so any divergence fails to
 * compile. Every field carries a description with its meaning and unit, so a person or a model
 * can write a valid scenario from the exported JSON Schema alone.
 */

const ms = (what: string) => z.number().min(0).describe(`${what}, in milliseconds (>= 0).`);
const positiveMs = (what: string) => z.number().gt(0).describe(`${what}, in milliseconds (> 0).`);
const fraction = (what: string) =>
  z.number().min(0).max(1).describe(`${what}, a fraction in 0..1.`);
const rps = (what: string) => z.number().min(0).describe(`${what}, in requests per second (>= 0).`);
const id = (what: string) =>
  z
    .string()
    .min(1)
    .regex(/^[^.\s]+$/, "ids must not be empty, contain dots or whitespace")
    .describe(`Stable identifier of the ${what}. No dots or whitespace.`);

export const distSchema: z.ZodType<Dist> = z.lazy(() =>
  z
    .discriminatedUnion("type", [
      z
        .strictObject({ type: z.literal("constant"), ms: ms("Fixed value") })
        .describe("Always the same value."),
      z
        .strictObject({
          type: z.literal("uniform"),
          minMs: ms("Lower bound (inclusive)"),
          maxMs: ms("Upper bound (exclusive); must be >= minMs"),
        })
        .describe("Uniform between minMs and maxMs."),
      z
        .strictObject({
          type: z.literal("normal"),
          meanMs: ms("Mean"),
          stdMs: ms("Standard deviation"),
        })
        .describe("Normal distribution truncated at 0 (negative samples are redrawn)."),
      z
        .strictObject({
          type: z.literal("lognormal"),
          p50Ms: positiveMs("Median"),
          p99Ms: positiveMs("99th percentile; must be >= p50Ms"),
        })
        .describe(
          "Lognormal defined by its median and p99 (mu = ln p50, sigma = (ln p99 - ln p50) / 2.3263). Typical for service latencies.",
        ),
      z
        .strictObject({ type: z.literal("exponential"), meanMs: positiveMs("Mean") })
        .describe("Exponential distribution."),
      z
        .strictObject({
          type: z.literal("mixture"),
          components: z
            .array(
              z.strictObject({
                weight: z.number().gt(0).describe("Relative weight (> 0); weights are normalized."),
                dist: distSchema,
              }),
            )
            .min(1)
            .describe("Components chosen with probability weight / sum(weights)."),
        })
        .describe("Mixture of distributions, e.g. 95% fast + 5% slow."),
    ])
    .describe("A duration distribution in milliseconds."),
);

const failureKindSchema = z
  .enum(["http-5xx", "timeout", "connection-refused", "circuit-open", "bulkhead-full"])
  .describe(
    "Failure kinds: http-5xx (500 or 503 load shedding), timeout, connection-refused (outage), circuit-open (breaker rejected), bulkhead-full (concurrency limit).",
  ) satisfies z.ZodType<FailureKind>;

const timeoutSchema = z
  .strictObject({
    valueMs: positiveMs("Attempt timeout"),
    enforcement: z
      .enum(["timer", "caller-pool"])
      .describe(
        "Who enforces the deadline. 'timer' (default): it fires on time, like the Quarkus REST client read-timeout (Vert.x event loop). 'caller-pool': the interruption runs on the worker pool of the calling node, like a synchronous SmallRye @Timeout in Quarkus: late when the pool is busy, lost when its queue is full; options.defaultEdgeTimeoutMs still applies as a backstop.",
      )
      .exactOptional(),
  })
  .describe(
    "@Timeout: fail an attempt with `timeout` after valueMs.",
  ) satisfies z.ZodType<TimeoutPolicy>;

const retrySchema = z
  .strictObject({
    maxRetries: z
      .number()
      .int()
      .min(-1)
      .describe("Maximum retries after the first attempt; -1 = unlimited."),
    delayMs: ms("Delay before each retry"),
    jitterMs: ms("Random jitter: the delay varies uniformly by +/- jitterMs (never below 0)"),
    maxDurationMs: ms(
      "Stop retrying once this time has elapsed since the first attempt; default 180000, 0 = unlimited",
    ).exactOptional(),
    backoffFactor: z
      .number()
      .min(1)
      .describe("Exponential backoff factor (SmallRye @ExponentialBackoff): delay x factor^n.")
      .exactOptional(),
    maxDelayMs: ms("Cap for exponential backoff delays; default 60000, 0 = no cap").exactOptional(),
    retryOn: z
      .array(failureKindSchema)
      .describe("Failure kinds that trigger a retry; default: all (including circuit-open).")
      .exactOptional(),
    abortOn: z
      .array(failureKindSchema)
      .describe("Failure kinds that stop retrying; takes precedence over retryOn. Default: none.")
      .exactOptional(),
  })
  .describe("@Retry.") satisfies z.ZodType<RetryPolicy>;

const circuitBreakerSchema = z
  .strictObject({
    requestVolumeThreshold: z
      .number()
      .int()
      .min(1)
      .describe("Size of the rolling window of attempts."),
    failureRatio: fraction("Opens when failures / window >= failureRatio (window must be full)"),
    delayMs: ms("Time spent open before moving to half-open"),
    successThreshold: z
      .number()
      .int()
      .min(1)
      .describe("Probe attempts allowed in half-open; all must succeed to close."),
    failOn: z
      .array(failureKindSchema)
      .describe("Failure kinds counted as failures; default: all.")
      .exactOptional(),
  })
  .describe("@CircuitBreaker, one per edge.") satisfies z.ZodType<CircuitBreakerPolicy>;

const bulkheadSchema = z
  .strictObject({
    value: z.number().int().min(1).describe("Maximum concurrent attempts on this edge."),
    waitingTaskQueue: z
      .number()
      .int()
      .min(0)
      .describe("Attempts allowed to wait for a slot (FIFO); default 0.")
      .exactOptional(),
  })
  .describe(
    "@Bulkhead: excess attempts fail with bulkhead-full.",
  ) satisfies z.ZodType<BulkheadPolicy>;

const fallbackSchema = z
  .strictObject({
    countsAs: z
      .enum(["degraded", "success"])
      .describe("How a fallback answer is classified. Degraded answers are not goodput."),
    latency: distSchema.describe("Time the fallback takes to answer.").exactOptional(),
  })
  .describe(
    "@Fallback: answers when everything inside it failed.",
  ) satisfies z.ZodType<FallbackPolicy>;

const policiesSchema = z
  .strictObject({
    timeout: timeoutSchema.exactOptional(),
    retry: retrySchema.exactOptional(),
    circuitBreaker: circuitBreakerSchema.exactOptional(),
    bulkhead: bulkheadSchema.exactOptional(),
    fallback: fallbackSchema.exactOptional(),
  })
  .describe(
    "Client resilience policies of the caller on this edge (presence = enabled). Composition: Fallback(Retry(CircuitBreaker(Timeout(Bulkhead(attempt))))).",
  ) satisfies z.ZodType<ClientPolicies>;

export const callSchema = z
  .strictObject({
    edgeId: id("edge to call"),
    probability: fraction("Probability the call is made; default 1").exactOptional(),
    routes: z
      .array(z.string())
      .describe("Only call when the request's route is one of these.")
      .exactOptional(),
    required: z
      .boolean()
      .describe("If false, a failure of this call does not fail the caller; default true.")
      .exactOptional(),
  })
  .describe(
    "A dependency call, made after the node's own service time.",
  ) satisfies z.ZodType<CallSpec>;

export const nodeSchema = z
  .strictObject({
    id: id("node"),
    name: z.string().describe("Display name."),
    kind: z.enum(["service", "external-api"]).describe("Node kind."),
    workers: z.number().int().min(1).describe("Concurrent requests the node can process."),
    queueLimit: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe("Max waiting requests; when full the node answers 503. null = unbounded."),
    workerModel: z
      .enum(["blocking", "async"])
      .describe(
        "blocking: a worker is held while waiting for dependencies (thread-per-request). async: released after its own service time.",
      ),
    serviceTime: distSchema.describe("Own processing time per request, excluding dependencies."),
    errorRate: fraction("Probability of answering 500 after the service time"),
    calls: z.array(callSchema).describe("Dependencies called in sequence, in this order."),
  })
  .describe("A service or external API.") satisfies z.ZodType<NodeSpec>;

export const edgeSchema = z
  .strictObject({
    id: id("edge"),
    from: id("calling node"),
    to: id("called node"),
    latency: distSchema.describe(
      "One-way network latency, sampled for the request and the response separately.",
    ),
    packetLoss: fraction("Probability that each leg is lost (only a timeout resolves it)"),
    policies: policiesSchema,
  })
  .describe(
    "A network link from a caller to a dependency, with the caller's client policies.",
  ) satisfies z.ZodType<EdgeSpec>;

const trafficPatternSchema = z
  .discriminatedUnion("type", [
    z
      .strictObject({ type: z.literal("constant"), rps: rps("Evenly spaced rate") })
      .describe("Evenly spaced arrivals."),
    z
      .strictObject({ type: z.literal("poisson"), rps: rps("Average rate") })
      .describe("Random (Poisson) arrivals."),
    z
      .strictObject({
        type: z.literal("ramp"),
        fromRps: rps("Initial rate"),
        toRps: rps("Final rate"),
        durationMs: ms("Duration of the ramp from the source's startMs"),
      })
      .describe("Poisson arrivals whose rate changes linearly, then stays at toRps."),
    z
      .strictObject({
        type: z.literal("spike"),
        baseRps: rps("Rate outside the spike"),
        peakRps: rps("Rate at the peak"),
        atMs: ms("Start of the spike (absolute scenario time)"),
        holdMs: ms("Time at the peak"),
        rampMs: ms("Ramp up and ramp down time; default 0").exactOptional(),
      })
      .describe("Poisson arrivals with a temporary spike."),
  ])
  .describe("Arrival pattern.") satisfies z.ZodType<TrafficPattern>;

export const trafficSchema = z
  .strictObject({
    id: id("traffic source"),
    target: id("entry node"),
    route: z
      .string()
      .describe("Route of the requests (e.g. /orders), matched by CallSpec.routes.")
      .exactOptional(),
    pattern: trafficPatternSchema,
    startMs: ms("When the source starts; default 0").exactOptional(),
    endMs: ms("When the source stops; default durationMs").exactOptional(),
  })
  .describe("A source of root requests.") satisfies z.ZodType<TrafficSpec>;

const faultTargetSchema = z
  .union([
    z.strictObject({ node: id("target node") }),
    z.strictObject({ edge: id("target edge") }),
    z.strictObject({ traffic: id("target traffic source") }),
  ])
  .describe(
    "What the fault affects: exactly one of node, edge or traffic.",
  ) satisfies z.ZodType<FaultTarget>;

const faultEffectSchema = z
  .discriminatedUnion("type", [
    z
      .strictObject({ type: z.literal("latency-add"), add: distSchema })
      .describe("Node or edge: add this time (to service time or to each network leg)."),
    z
      .strictObject({
        type: z.literal("latency-multiply"),
        factor: z.number().min(0).describe("Multiplier (>= 0)."),
      })
      .describe("Node or edge: multiply latency."),
    z
      .strictObject({ type: z.literal("error-rate"), rate: fraction("Replacement error rate") })
      .describe("Node: override errorRate."),
    z
      .strictObject({
        type: z.literal("outage"),
        mode: z
          .enum(["refuse", "blackhole"])
          .describe("refuse: fail fast with connection-refused. blackhole: never answer."),
      })
      .describe("Node or edge: unavailable."),
    z
      .strictObject({
        type: z.literal("capacity"),
        workersFactor: z
          .number()
          .min(0)
          .describe("Multiplier of workers (>= 0); running work is not interrupted."),
      })
      .describe("Node: lose capacity."),
    z
      .strictObject({ type: z.literal("packet-loss"), rate: fraction("Additional loss per leg") })
      .describe("Edge: extra packet loss."),
    z
      .strictObject({
        type: z.literal("traffic-multiply"),
        factor: z.number().min(0).describe("Rate multiplier (>= 0)."),
      })
      .describe("Traffic source: scale the rate."),
  ])
  .describe("The effect while the fault is active.") satisfies z.ZodType<FaultEffect>;

export const faultSchema = z
  .strictObject({
    id: id("fault"),
    startMs: ms("When the fault starts"),
    durationMs: ms("How long it lasts"),
    target: faultTargetSchema,
    effect: faultEffectSchema,
  })
  .describe("A time-boxed fault injected into the system.") satisfies z.ZodType<FaultSpec>;

export const scenarioObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(1).describe("Scenario format version."),
    name: z.string().min(1).describe("Scenario name."),
    description: z.string().describe("What the scenario shows.").exactOptional(),
    seed: z.number().int().describe("Random seed; same scenario + seed = same result."),
    durationMs: positiveMs("Traffic generation horizon"),
    options: z
      .strictObject({
        cancelOnTimeout: z
          .boolean()
          .describe(
            "If true, a timed-out attempt cancels the server-side work; default false (work continues: orphaned work).",
          )
          .exactOptional(),
        defaultEdgeTimeoutMs: positiveMs(
          "Attempt timeout for edges without a timeout policy; default 30000 (Quarkus REST Client read-timeout)",
        ).exactOptional(),
        drainMs: ms(
          "Extra time after durationMs to finish in-flight work; default 60000",
        ).exactOptional(),
      })
      .describe("Simulation options.")
      .exactOptional(),
    metrics: z
      .strictObject({ bucketMs: positiveMs("Width of each time-series bucket; default 1000") })
      .describe("Metrics options.")
      .exactOptional(),
    nodes: z.array(nodeSchema).min(1).describe("Services and external APIs."),
    edges: z.array(edgeSchema).describe("Links between nodes."),
    traffic: z.array(trafficSchema).describe("Traffic sources."),
    faults: z.array(faultSchema).describe("Injected faults."),
  })
  .describe(
    "A Fragor scenario: an architecture, its load and its faults. A simulation of it is not a prediction: results depend on the parameters you assume.",
  ) satisfies z.ZodType<Scenario>;
