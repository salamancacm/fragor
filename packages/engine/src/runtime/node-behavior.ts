import type { Rng } from "../core/rng";
import type { SeriesBuilder } from "../metrics/series-builder";
import type { SpanRef } from "../metrics/traces";
import type { FailureKind, Ms, NodeSnapshot, NodeSpec } from "../model/types";
import type { NodeEffects } from "./faults";
import type { RootRequest } from "./roots";
import type { Scheduler } from "./scheduler";

/**
 * Outcome of a job as seen by its caller. `failure` is what the caller observes (a failed
 * dependency surfaces as http-5xx); `cause` is the FailureKind where the failure originated,
 * propagated through 500 responses so roots can report the root cause.
 */
export type JobResult =
  | { ok: true; degraded: boolean }
  | { ok: false; failure: FailureKind; cause: FailureKind };

/**
 * One unit of server-side work: a request that reached a node. The node calls `reply` exactly
 * once, at the virtual time the response leaves the node, unless the job is cancelled.
 */
export interface Job {
  readonly id: number;
  readonly nodeId: string;
  readonly root: RootRequest;
  readonly arrivedAtMs: Ms;
  readonly reply: (result: JobResult) => void;
  /** Trace span of this job, null when the root is not sampled. */
  readonly span: SpanRef | null;
  /** The caller timed out; the work goes on (orphaned work). */
  orphaned: boolean;
  /** The caller cancelled the work (options.cancelOnTimeout). */
  cancelled: boolean;
}

/** Outcome of one invocation through an edge, after every client policy. */
export type CallOutcome =
  | { status: "success" }
  | { status: "degraded" }
  | { status: "failed"; failure: FailureKind; cause: FailureKind };

export interface InvocationHandle {
  /** Stops the invocation: no further attempts, the current one is cancelled downstream. */
  cancel(): void;
}

/** Services a node behavior may use. Nothing here is node-kind specific. */
export interface NodeContext {
  readonly scheduler: Scheduler;
  readonly series: SeriesBuilder;
  readonly global: SeriesBuilder;
  /** Independent RNG sub-stream of this node for a given purpose (e.g. "service"). */
  stream(purpose: string): Rng;
  /** Combined effect of the faults currently active on this node. */
  faults(): NodeEffects;
  /** Calls a dependency through an edge, applying the edge's client policies. */
  invoke(edgeId: string, parent: Job, done: (outcome: CallOutcome) => void): InvocationHandle;
}

/**
 * Extension point for node kinds. A behavior decides how a job is admitted, processed and
 * answered; the event kernel and client policies never look inside it.
 */
export interface NodeBehavior {
  readonly spec: NodeSpec;
  /** Called when a request reaches the node (after the network leg, if any). */
  arrive(job: Job): void;
  /** The caller cancelled `job` (job.cancelled is already true). Must not call job.reply. */
  cancel(job: Job): void;
  /** Faults on this node changed (capacity, latency, error rate). */
  onFaultsChanged(): void;
  snapshot(): NodeSnapshot;
}

export type NodeFactory = (spec: NodeSpec, ctx: NodeContext) => NodeBehavior;
