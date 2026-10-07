import { compileDist, type Sampler } from "../core/distributions";
import type { Rng } from "../core/rng";
import type { SeriesBuilder } from "../metrics/series-builder";
import type { EdgeSpec, Ms } from "../model/types";
import type { Bulkhead } from "../policies/bulkhead";
import type { CircuitBreaker } from "../policies/circuit-breaker";
import type { CompiledFallback } from "../policies/fallback";
import type { FaultRegistry, LatencyEffects } from "./faults";

/** Everything the call pipeline needs about one edge, built once per simulation. */
export interface EdgeRuntime {
  readonly spec: EdgeSpec;
  readonly series: SeriesBuilder;
  readonly timeoutMs: Ms;
  /** How the timeout is enforced (TimeoutPolicy.enforcement, default "timer"). */
  readonly timeoutEnforcement: "timer" | "caller-pool";
  /**
   * Independent read-timeout backstop for "caller-pool" timeouts (defaultEdgeTimeoutMs), or null
   * when it would not fire before the policy timeout.
   */
  readonly backstopMs: Ms | null;
  readonly breaker: CircuitBreaker | null;
  readonly bulkhead: Bulkhead | null;
  readonly fallback: CompiledFallback | null;
  readonly network: NetworkLink;
  /** RNG for retry jitter and fallback latency. */
  readonly policyRng: Rng;
  inFlight: number;
}

export interface Leg {
  readonly delayMs: Ms;
  readonly lost: boolean;
}

/** Applies latency-add (sum of samples) and latency-multiply (product) fault effects. */
export function applyLatencyEffects(base: Ms, effects: LatencyEffects, rng: Rng): Ms {
  let value = base;
  for (const add of effects.add) value += add(rng);
  return value * effects.factor;
}

/**
 * One network link (an edge). Each leg (request or response) samples its own latency and loss.
 * Random draws: latency from `edge/<id>/latency`, loss from `edge/<id>/loss` (always drawn),
 * fault latency from `edge/<id>/fault-latency`.
 */
export class NetworkLink {
  private readonly latency: Sampler;

  constructor(
    private readonly spec: EdgeSpec,
    private readonly faults: FaultRegistry,
    private readonly latencyRng: Rng,
    private readonly lossRng: Rng,
    private readonly faultRng: Rng,
  ) {
    this.latency = compileDist(spec.latency, `edges[${spec.id}].latency`);
  }

  /** Edge-level outage, if a fault is active on this edge. */
  outage(): "refuse" | "blackhole" | null {
    return this.faults.edge(this.spec.id).outage;
  }

  leg(): Leg {
    const effects = this.faults.edge(this.spec.id);
    const delayMs = applyLatencyEffects(this.latency(this.latencyRng), effects, this.faultRng);
    let keep = 1 - this.spec.packetLoss;
    for (const rate of effects.lossRates) keep *= 1 - rate;
    const lost = this.lossRng.next() >= keep;
    return { delayMs, lost };
  }
}
