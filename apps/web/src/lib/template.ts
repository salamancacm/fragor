import type { ClientPolicies, FaultSpec, NodeSpec, Scenario } from "@fragor/engine";
import { type ParseResult, safeParseScenario } from "@fragor/scenarios";
import { DEFAULT_BREAKER, DEFAULT_RETRY } from "./params";

export type FaultKind = "none" | "slower" | "errors" | "down";

/**
 * The quick form: one service of yours, one dependency it calls, and the failure to try. Every
 * field maps to a number you can read from your service's configuration or metrics.
 */
export interface TemplateForm {
  serviceName: string;
  /** Worker threads (Quarkus: quarkus.thread-pool.max-threads or your executor size). */
  workers: number;
  /** Requests that may wait for a worker; null = unbounded. */
  queueLimit: number | null;
  /** Own processing time of the service, without the dependency call. */
  serviceP50Ms: number;
  serviceP99Ms: number;
  /** blocking: the thread waits for the dependency; async (reactive): it does not. */
  workerModel: "blocking" | "async";
  /** Incoming requests per second at peak. */
  rps: number;
  dependencyName: string;
  dependencyKind: "external-api" | "service";
  /** Worker threads of the dependency (only for a service you also run). */
  dependencyWorkers: number;
  dependencyP50Ms: number;
  dependencyP99Ms: number;
  /** Share of calls the dependency answers with an error, 0..1. */
  dependencyErrorRate: number;
  networkMs: number;
  /** Per-attempt timeout; null = no @Timeout (the REST client read timeout, 30 s, applies). */
  timeoutMs: number | null;
  timeoutOnCallerPool: boolean;
  retries: number;
  retryDelayMs: number;
  breaker: boolean;
  fallback: boolean;
  fault: FaultKind;
  /** Extra latency in ms ("slower") or error share 0..1 ("errors"); unused otherwise. */
  faultAmount: number;
  faultStartS: number;
  faultDurationS: number;
  durationS: number;
}

export const DEFAULT_TEMPLATE: TemplateForm = {
  serviceName: "My service",
  workers: 40,
  queueLimit: 100,
  serviceP50Ms: 15,
  serviceP99Ms: 60,
  workerModel: "blocking",
  rps: 150,
  dependencyName: "Inventory API",
  dependencyKind: "external-api",
  dependencyWorkers: 50,
  dependencyP50Ms: 80,
  dependencyP99Ms: 300,
  dependencyErrorRate: 0.01,
  networkMs: 2,
  timeoutMs: 1000,
  timeoutOnCallerPool: false,
  retries: 2,
  retryDelayMs: 200,
  breaker: false,
  fallback: false,
  fault: "slower",
  faultAmount: 3000,
  faultStartS: 20,
  faultDurationS: 20,
  durationS: 60,
};

const SERVICE = "my-service";
const DEPENDENCY = "dependency";
const EDGE = "my-service-dependency";

function policies(f: TemplateForm): ClientPolicies {
  const p: ClientPolicies = {};
  if (f.timeoutMs !== null)
    p.timeout = {
      valueMs: f.timeoutMs,
      ...(f.timeoutOnCallerPool ? { enforcement: "caller-pool" as const } : {}),
    };
  if (f.retries > 0)
    p.retry = { maxRetries: f.retries, delayMs: f.retryDelayMs, jitterMs: DEFAULT_RETRY.jitterMs };
  if (f.breaker) p.circuitBreaker = { ...DEFAULT_BREAKER };
  if (f.fallback) p.fallback = { countsAs: "degraded" };
  return p;
}

function fault(f: TemplateForm): FaultSpec[] {
  if (f.fault === "none") return [];
  const base = {
    id: `dependency-${f.fault}`,
    startMs: f.faultStartS * 1000,
    durationMs: f.faultDurationS * 1000,
    target: { node: DEPENDENCY },
  };
  if (f.fault === "slower")
    return [
      {
        ...base,
        effect: { type: "latency-add", add: { type: "constant", ms: f.faultAmount } },
      },
    ];
  if (f.fault === "errors")
    return [{ ...base, effect: { type: "error-rate", rate: f.faultAmount } }];
  return [{ ...base, effect: { type: "outage", mode: "refuse" } }];
}

/** The scenario described by the quick form. */
export function templateScenario(f: TemplateForm): Scenario {
  const external = f.dependencyKind === "external-api";
  const service: NodeSpec = {
    id: SERVICE,
    name: f.serviceName.trim() || "My service",
    kind: "service",
    workers: f.workers,
    queueLimit: f.queueLimit,
    workerModel: f.workerModel,
    serviceTime: { type: "lognormal", p50Ms: f.serviceP50Ms, p99Ms: f.serviceP99Ms },
    errorRate: 0,
    calls: [{ edgeId: EDGE }],
  };
  const dependency: NodeSpec = {
    id: DEPENDENCY,
    name: f.dependencyName.trim() || "Dependency",
    kind: f.dependencyKind,
    // An external API is someone else's: model it as roomy enough never to be the bottleneck.
    workers: external ? 1000 : f.dependencyWorkers,
    queueLimit: null,
    workerModel: "blocking",
    serviceTime: { type: "lognormal", p50Ms: f.dependencyP50Ms, p99Ms: f.dependencyP99Ms },
    errorRate: f.dependencyErrorRate,
    calls: [],
  };
  return {
    schemaVersion: 1,
    name: `${service.name} → ${dependency.name}`,
    description: `${service.name} (${f.workers} workers) calls ${dependency.name} at ${f.rps} req/s.`,
    seed: 1,
    durationMs: f.durationS * 1000,
    nodes: [service, dependency],
    edges: [
      {
        id: EDGE,
        from: SERVICE,
        to: DEPENDENCY,
        latency: { type: "constant", ms: f.networkMs },
        packetLoss: 0,
        policies: policies(f),
      },
    ],
    traffic: [{ id: "users", target: SERVICE, pattern: { type: "poisson", rps: f.rps } }],
    faults: fault(f),
  };
}

/** Builds and validates the scenario with the same schema as any imported one. */
export function checkTemplate(f: TemplateForm): ParseResult {
  return safeParseScenario(templateScenario(f));
}
