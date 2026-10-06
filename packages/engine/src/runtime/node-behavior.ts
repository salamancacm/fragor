import type { Rng } from "../core/rng";
import type { SeriesBuilder } from "../metrics/series-builder";
import type { SpanRef } from "../metrics/traces";
import type { FailureKind, Ms, NodeSnapshot, NodeSpec } from "../model/types";
import type { RootRequest } from "./roots";
import type { Scheduler } from "./scheduler";

/** Outcome of a job as seen by the node that processed it. */
export type JobResult = { ok: true } | { ok: false; failure: FailureKind };

/**
 * One unit of server-side work: a request that reached a node. The node calls `reply`
 * exactly once, at the virtual time the response leaves the node. Whoever created the job
 * (a traffic source for roots, a call attempt in M2) decides what the reply means.
 */
export interface Job {
  readonly id: number;
  readonly root: RootRequest;
  readonly arrivedAtMs: Ms;
  readonly reply: (result: JobResult) => void;
  /** Trace span of this job, null when the root is not sampled. */
  span: SpanRef | null;
}

/** Services a node behavior may use. Nothing here is node-kind specific. */
export interface NodeContext {
  readonly scheduler: Scheduler;
  readonly series: SeriesBuilder;
  /** Independent RNG sub-stream of this node for a given purpose (e.g. "service"). */
  stream(purpose: string): Rng;
}

/**
 * Extension point for node kinds. A behavior decides how a job is admitted, processed and
 * answered; the event kernel and client policies never look inside it.
 */
export interface NodeBehavior {
  readonly spec: NodeSpec;
  /** Called when a request reaches the node (after the network leg, if any). */
  arrive(job: Job): void;
  snapshot(): NodeSnapshot;
}

export type NodeFactory = (spec: NodeSpec, ctx: NodeContext) => NodeBehavior;
