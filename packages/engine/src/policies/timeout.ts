import type { EdgeSpec, Ms } from "../model/types";

/**
 * Default per-attempt deadline when an edge has no timeout policy. Mirrors the Quarkus REST
 * Client default `quarkus.rest-client.read-timeout` (30 000 ms).
 */
export const DEFAULT_EDGE_TIMEOUT_MS = 30_000;

/**
 * The read-timeout backstop of a "caller-pool" timeout: the scenario default (Quarkus REST client
 * read timeout), enforced independently of any worker pool. Null when it is not later than the
 * policy timeout (the policy deadline then always comes first) or the edge uses "timer".
 */
export function backstopMs(edge: EdgeSpec, defaultMs: Ms | undefined): Ms | null {
  const policy = edge.policies.timeout;
  if (policy?.enforcement !== "caller-pool") return null;
  const readTimeout = defaultMs ?? DEFAULT_EDGE_TIMEOUT_MS;
  return readTimeout > policy.valueMs ? readTimeout : null;
}

/** The attempt deadline: the edge's timeout policy if present, else the scenario default. */
export function attemptTimeoutMs(edge: EdgeSpec, defaultMs: Ms | undefined): Ms {
  return edge.policies.timeout?.valueMs ?? defaultMs ?? DEFAULT_EDGE_TIMEOUT_MS;
}
