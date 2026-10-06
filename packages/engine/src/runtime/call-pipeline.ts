import type { SeriesBuilder } from "../metrics/series-builder";
import { closeSpan, flagSpan, openChildSpan, type SpanRef } from "../metrics/traces";
import type { FailureKind } from "../model/types";
import type { BulkheadWaiter } from "../policies/bulkhead";
import { canRetry, maxDurationReached, retryDelay } from "../policies/retry";
import type { EdgeRuntime } from "./network";
import type { CallOutcome, InvocationHandle, Job, JobResult } from "./node-behavior";
import type { ScheduledEvent, Scheduler } from "./scheduler";

/** What the pipeline needs from the simulation world. */
export interface CallWorld {
  readonly scheduler: Scheduler;
  readonly global: SeriesBuilder;
  readonly cancelOnTimeout: boolean;
  /**
   * Delivers a request to `nodeId`, applying node outages. Returns the job, or null when the
   * node is unreachable (refuse: the reply already carries connection-refused; blackhole: none).
   */
  deliver(
    nodeId: string,
    parent: Job,
    parentSpan: SpanRef | null,
    reply: (r: JobResult) => void,
    orphaned: boolean,
  ): Job | null;
  /** Cancels a job at its node (cancelOnTimeout propagation). */
  cancelJob(job: Job): void;
}

/** One try through Timeout(Bulkhead(network + server)). */
interface Attempt {
  readonly index: number;
  readonly span: SpanRef | null;
  generation: number | null;
  timer: ScheduledEvent | null;
  waiter: BulkheadWaiter | null;
  holdsBulkhead: boolean;
  /** Counted in edge.inFlight (admitted by the breaker). */
  inFlight: boolean;
  job: Job | null;
  /** Resolved from the caller's view (response, timeout, rejection or cancellation). */
  done: boolean;
  timedOut: boolean;
  cancelled: boolean;
}

/**
 * One logical call from `parent` through an edge, composed as
 * Fallback(Retry(CircuitBreaker(Timeout(Bulkhead(attempt))))) — the nesting order documented by
 * SmallRye Fault Tolerance. See docs/SEMANTICS.md 6.3-6.9.
 */
export class Invocation implements InvocationHandle {
  private readonly startMs: number;
  private readonly span: SpanRef | null;
  private attempts = 0;
  private retries = 0;
  private current: Attempt | null = null;
  private pendingRetry: ScheduledEvent | null = null;
  private finished = false;

  constructor(
    private readonly world: CallWorld,
    private readonly edge: EdgeRuntime,
    private readonly parent: Job,
    private readonly done: (outcome: CallOutcome) => void,
  ) {
    this.startMs = world.scheduler.nowMs;
    this.span = openChildSpan(parent.span, "invocation", this.startMs, { edgeId: edge.spec.id });
    edge.series.inc("arrivals");
    this.tryAttempt();
  }

  cancel(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.pendingRetry !== null) this.world.scheduler.cancel(this.pendingRetry);
    const att = this.current;
    if (att !== null && !att.done) this.cancelAttempt(att);
    flagSpan(this.span, "cancelled");
    closeSpan(this.span, this.now, "failed", null);
  }

  private get now(): number {
    return this.world.scheduler.nowMs;
  }

  private count(field: Parameters<SeriesBuilder["inc"]>[0]): void {
    this.edge.series.inc(field);
    this.world.global.inc(field);
  }

  private tryAttempt(): void {
    const { edge } = this;
    const att: Attempt = {
      index: this.attempts++,
      span: openChildSpan(this.span, "attempt", this.now, {
        edgeId: edge.spec.id,
        nodeId: edge.spec.to,
        attempt: this.attempts - 1,
      }),
      generation: null,
      timer: null,
      waiter: null,
      holdsBulkhead: false,
      inFlight: false,
      job: null,
      done: false,
      timedOut: false,
      cancelled: false,
    };
    this.current = att;
    this.count("attempts");
    if (edge.breaker !== null) {
      att.generation = edge.breaker.tryAcquire();
      if (att.generation === null) {
        this.count("circuitOpen");
        this.resolve(att, { ok: false, failure: "circuit-open", cause: "circuit-open" }, false);
        return;
      }
    }
    // The timeout watcher starts before the bulkhead, so bulkhead waiting counts toward it.
    att.timer = this.world.scheduler.schedule(this.now + edge.timeoutMs, "TIMEOUT_FIRED", () =>
      this.onTimeout(att),
    );
    edge.inFlight++;
    att.inFlight = true;
    if (edge.bulkhead === null) {
      this.send(att);
      return;
    }
    const waiter: BulkheadWaiter = {
      admit: () => {
        att.waiter = null;
        att.holdsBulkhead = true;
        this.send(att);
      },
    };
    att.waiter = waiter;
    if (edge.bulkhead.enter(waiter) === "rejected") {
      att.waiter = null;
      this.count("bulkheadFull");
      this.resolve(att, { ok: false, failure: "bulkhead-full", cause: "bulkhead-full" }, true);
    }
  }

  /** Request leg: latency, loss, edge outage, then delivery to the target node. */
  private send(att: Attempt): void {
    const { network, spec } = this.edge;
    const outage = network.outage();
    const leg = network.leg();
    if (outage === "blackhole" || leg.lost) return; // only the timeout resolves it
    this.world.scheduler.schedule(this.now + leg.delayMs, "ARRIVE_AT_NODE", () => {
      if (att.cancelled) return;
      if (outage === "refuse") {
        this.respond(att, {
          ok: false,
          failure: "connection-refused",
          cause: "connection-refused",
        });
        return;
      }
      att.job = this.world.deliver(
        spec.to,
        this.parent,
        att.span,
        (r) => this.respond(att, r),
        att.timedOut,
      );
    });
  }

  /** Response leg back to the caller. */
  private respond(att: Attempt, result: JobResult): void {
    const leg = this.edge.network.leg();
    if (leg.lost) return;
    this.world.scheduler.schedule(this.now + leg.delayMs, "RESPONSE_AT_CALLER", () => {
      if (att.cancelled) return;
      if (att.done) {
        if (att.timedOut) {
          this.count("orphanedResponses");
          flagSpan(att.span, "orphaned");
        }
        return;
      }
      this.resolve(att, result, true);
    });
  }

  private onTimeout(att: Attempt): void {
    att.timer = null;
    att.timedOut = true;
    this.count("timeouts");
    const job = att.job;
    if (job !== null) {
      if (this.world.cancelOnTimeout) {
        job.cancelled = true;
        this.world.cancelJob(job);
      } else {
        job.orphaned = true;
        flagSpan(job.span, "orphaned");
      }
    } else if (this.world.cancelOnTimeout) {
      att.cancelled = true; // a request still on the wire is dropped on arrival
    }
    this.resolve(att, { ok: false, failure: "timeout", cause: "timeout" }, true);
  }

  /** Ends an attempt from the caller's view and feeds breaker, retry and fallback. */
  private resolve(att: Attempt, result: JobResult, recordBreaker: boolean): void {
    this.releaseAttempt(att);
    const breaker = this.edge.breaker;
    if (breaker !== null && att.generation !== null && recordBreaker) {
      breaker.record(att.generation, !result.ok && breaker.countsAsFailure(result.failure));
    }
    if (result.ok) {
      closeSpan(att.span, this.now, result.degraded ? "degraded" : "success", null);
      this.finish(result.degraded ? { status: "degraded" } : { status: "success" });
      return;
    }
    closeSpan(att.span, this.now, "failed", result.failure);
    this.afterFailure(result.failure, result.cause);
  }

  private releaseAttempt(att: Attempt): void {
    att.done = true;
    if (att.timer !== null) {
      this.world.scheduler.cancel(att.timer);
      att.timer = null;
    }
    const bulkhead = this.edge.bulkhead;
    if (bulkhead !== null && att.waiter !== null) bulkhead.abandon(att.waiter);
    att.waiter = null;
    if (bulkhead !== null && att.holdsBulkhead) bulkhead.leave();
    att.holdsBulkhead = false;
    if (att.inFlight) this.edge.inFlight--;
    att.inFlight = false;
  }

  private cancelAttempt(att: Attempt): void {
    att.cancelled = true;
    if (att.generation !== null) this.edge.breaker?.releaseProbe(att.generation);
    this.releaseAttempt(att);
    if (att.job !== null) {
      att.job.cancelled = true;
      this.world.cancelJob(att.job);
    }
    flagSpan(att.span, "cancelled");
    closeSpan(att.span, this.now, "failed", null);
  }

  private afterFailure(failure: FailureKind, cause: FailureKind): void {
    const policy = this.edge.spec.policies.retry;
    if (policy === undefined || !canRetry(policy, failure, this.retries, this.now - this.startMs)) {
      this.fail(failure, cause);
      return;
    }
    const delay = retryDelay(policy, this.retries, this.edge.policyRng);
    this.retries++;
    this.count("retries");
    const wait = openChildSpan(this.span, "retry-wait", this.now, { edgeId: this.edge.spec.id });
    this.pendingRetry = this.world.scheduler.schedule(this.now + delay, "RETRY_DUE", () => {
      this.pendingRetry = null;
      closeSpan(wait, this.now, "success", null);
      // SmallRye checks maxDuration again after the delay.
      if (maxDurationReached(policy, this.now - this.startMs)) this.fail(failure, cause);
      else this.tryAttempt();
    });
  }

  private fail(failure: FailureKind, cause: FailureKind): void {
    const fallback = this.edge.fallback;
    if (fallback === null) {
      this.finish({ status: "failed", failure, cause });
      return;
    }
    this.count("fallbacks");
    const span = openChildSpan(this.span, "fallback", this.now, { edgeId: this.edge.spec.id });
    const status = fallback.countsAs === "degraded" ? "degraded" : "success";
    const answer = (): void => {
      closeSpan(span, this.now, status, null);
      this.finish({ status });
    };
    if (fallback.latency === null) {
      answer();
      return;
    }
    const delay = fallback.latency(this.edge.policyRng);
    this.pendingRetry = this.world.scheduler.schedule(this.now + delay, "FALLBACK_DONE", () => {
      this.pendingRetry = null;
      answer();
    });
  }

  private finish(outcome: CallOutcome): void {
    if (this.finished) return;
    this.finished = true;
    const series = this.edge.series;
    series.inc(outcome.status === "failed" ? "failed" : outcome.status);
    series.recordLatency(this.now - this.startMs);
    closeSpan(
      this.span,
      this.now,
      outcome.status,
      outcome.status === "failed" ? outcome.failure : null,
    );
    this.done(outcome);
  }
}
