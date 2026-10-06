import type { EdgeSpec, Ms } from "../model/types";

/**
 * Default per-attempt deadline when an edge has no timeout policy. Mirrors the Quarkus REST
 * Client default `quarkus.rest-client.read-timeout` (30 000 ms).
 */
export const DEFAULT_EDGE_TIMEOUT_MS = 30_000;

/** The attempt deadline: the edge's timeout policy if present, else the scenario default. */
export function attemptTimeoutMs(edge: EdgeSpec, defaultMs: Ms | undefined): Ms {
  return edge.policies.timeout?.valueMs ?? defaultMs ?? DEFAULT_EDGE_TIMEOUT_MS;
}
