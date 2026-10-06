import { compileDist, type Sampler } from "../core/distributions";
import type { FallbackPolicy } from "../model/types";

/**
 * A fallback answers an invocation whose inner composition (retry included) failed. Its result
 * is `degraded` or `success` according to `countsAs`; the two are never merged.
 */
export interface CompiledFallback {
  readonly countsAs: "degraded" | "success";
  /** Fallback processing time; null means it answers immediately. */
  readonly latency: Sampler | null;
}

export function compileFallback(policy: FallbackPolicy, path: string): CompiledFallback {
  return {
    countsAs: policy.countsAs,
    latency: policy.latency === undefined ? null : compileDist(policy.latency, `${path}.latency`),
  };
}
