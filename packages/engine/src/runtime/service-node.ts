import { compileDist, type Sampler } from "../core/distributions";
import { Fifo } from "../core/fifo";
import type { Rng } from "../core/rng";
import { closeSpan, flagSpan } from "../metrics/traces";
import type { CallSpec, NodeSnapshot, NodeSpec } from "../model/types";
import { applyLatencyEffects } from "./network";
import type { InvocationHandle, Job, JobResult, NodeBehavior, NodeContext } from "./node-behavior";
import type { ScheduledEvent } from "./scheduler";

interface Work {
  readonly job: Job;
  phase: "queued" | "service" | "calls";
  holdsWorker: boolean;
  serviceDone: ScheduledEvent | null;
  invocation: InvocationHandle | null;
  degraded: boolean;
}

/**
 * Generic request/response service, used for "service" and "external-api":
 * `workers` concurrent jobs, a FIFO waiting queue bounded by `queueLimit` (503 when full),
 * own `serviceTime`, an `errorRate` of 500 responses, then dependency calls in sequence.
 * blocking: the worker is held while waiting for dependencies; async: it is released after
 * serviceTime and the job waits without a worker.
 */
export class ServiceNode implements NodeBehavior {
  private readonly queue = new Fifo<Work>();
  private readonly work = new Map<number, Work>();
  private readonly serviceTime: Sampler;
  private readonly serviceRng: Rng;
  private readonly errorRng: Rng;
  private readonly callRng: Rng;
  private readonly faultRng: Rng;
  private busy = 0;
  private waiting = 0;
  private arrivals = 0;
  private completed = 0;

  constructor(
    readonly spec: NodeSpec,
    private readonly ctx: NodeContext,
  ) {
    this.serviceTime = compileDist(spec.serviceTime, `nodes[${spec.id}].serviceTime`);
    this.serviceRng = ctx.stream("service");
    this.errorRng = ctx.stream("error");
    this.callRng = ctx.stream("calls");
    this.faultRng = ctx.stream("fault-latency");
    ctx.series.setEffectiveWorkers(0, this.effectiveWorkers());
  }

  arrive(job: Job): void {
    this.arrivals++;
    this.ctx.series.inc("arrivals");
    const w: Work = {
      job,
      phase: "queued",
      holdsWorker: false,
      serviceDone: null,
      invocation: null,
      degraded: false,
    };
    this.work.set(job.id, w);
    if (this.busy < this.effectiveWorkers()) {
      this.start(w);
    } else if (this.spec.queueLimit === null || this.queue.length < this.spec.queueLimit) {
      this.queue.push(w);
      this.ctx.series.setQueueDepth(this.now, this.queue.length);
    } else {
      this.ctx.series.inc("rejected503");
      this.ctx.global.inc("rejected503");
      this.finish(w, { ok: false, failure: "http-5xx", cause: "http-5xx" });
    }
  }

  cancel(job: Job): void {
    const w = this.work.get(job.id);
    if (w === undefined) return;
    if (w.phase === "queued") {
      this.queue.remove((q) => q === w);
      this.ctx.series.setQueueDepth(this.now, this.queue.length);
      this.drop(w);
    } else if (w.phase === "calls") {
      w.invocation?.cancel();
      this.drop(w);
    }
    // phase "service": own processing cannot be interrupted; serviceDone drops it.
  }

  onFaultsChanged(): void {
    this.ctx.series.setEffectiveWorkers(this.now, this.effectiveWorkers());
    this.startNext();
  }

  snapshot(): NodeSnapshot {
    return {
      arrivals: this.arrivals,
      completed: this.completed,
      inService: this.busy,
      queueDepth: this.queue.length,
      waitingOnDependencies: this.waiting,
      effectiveWorkers: this.effectiveWorkers(),
      busyWorkers: this.busy,
    };
  }

  private get now(): number {
    return this.ctx.scheduler.nowMs;
  }

  /** floor(workers x capacity factor), at least 1 unless the factor is 0. */
  private effectiveWorkers(): number {
    const factor = this.ctx.faults().workersFactor;
    if (factor === 1) return this.spec.workers;
    if (factor <= 0) return 0;
    return Math.max(1, Math.floor(this.spec.workers * factor));
  }

  private start(w: Work): void {
    this.busy++;
    w.holdsWorker = true;
    w.phase = "service";
    this.ctx.series.setBusy(this.now, this.busy);
    const effects = this.ctx.faults();
    const base = this.serviceTime(this.serviceRng);
    const duration = applyLatencyEffects(base, effects, this.faultRng);
    w.serviceDone = this.ctx.scheduler.schedule(this.now + duration, "SERVICE_DONE", () =>
      this.serviceDone(w),
    );
  }

  private serviceDone(w: Work): void {
    w.serviceDone = null;
    if (w.job.cancelled) {
      this.drop(w);
      return;
    }
    // Always draw, so changing errorRate never shifts the rest of this stream.
    const u = this.errorRng.next();
    const errorRate = this.ctx.faults().errorRate ?? this.spec.errorRate;
    if (u < errorRate) {
      this.finish(w, { ok: false, failure: "http-5xx", cause: "http-5xx" });
      return;
    }
    if (this.spec.calls.length === 0) {
      this.finish(w, { ok: true, degraded: false });
      return;
    }
    w.phase = "calls";
    if (this.spec.workerModel === "async") {
      this.releaseWorker(w);
      this.waiting++;
      this.startNext();
    }
    this.nextCall(w, 0);
  }

  /** Runs calls[i..] in sequence, skipping those excluded by route or probability. */
  private nextCall(w: Work, from: number): void {
    for (let i = from; i < this.spec.calls.length; i++) {
      const call = this.spec.calls[i] as CallSpec;
      // Always draw, so changing a probability never shifts the rest of this stream.
      const u = this.callRng.next();
      if (call.routes !== undefined && !call.routes.includes(w.job.root.route ?? "")) continue;
      if (u >= (call.probability ?? 1)) continue;
      // The invocation may settle synchronously (e.g. circuit open, no retry); only keep the
      // handle while it is still running, or a later call's handle would be overwritten.
      let settled = false;
      const handle = this.ctx.invoke(call.edgeId, w.job, (outcome) => {
        settled = true;
        w.invocation = null;
        if (outcome.status === "degraded") w.degraded = true;
        if (outcome.status === "failed" && call.required !== false) {
          this.finish(w, { ok: false, failure: "http-5xx", cause: outcome.cause });
          return;
        }
        this.nextCall(w, i + 1);
      });
      if (!settled) w.invocation = handle;
      return;
    }
    this.finish(w, { ok: true, degraded: w.degraded });
  }

  private releaseWorker(w: Work): void {
    if (!w.holdsWorker) return;
    w.holdsWorker = false;
    this.busy--;
    this.ctx.series.setBusy(this.now, this.busy);
  }

  private leave(w: Work): void {
    this.work.delete(w.job.id);
    if (w.holdsWorker) this.releaseWorker(w);
    else if (w.phase === "calls") this.waiting--;
    this.completed++;
  }

  private finish(w: Work, result: JobResult): void {
    this.leave(w);
    const { series } = this.ctx;
    series.inc(result.ok ? (result.degraded ? "degraded" : "success") : "failed");
    series.recordLatency(this.now - w.job.arrivedAtMs);
    if (w.job.orphaned) {
      series.inc("orphanedWork");
      this.ctx.global.inc("orphanedWork");
    }
    const outcome = result.ok ? (result.degraded ? "degraded" : "success") : "failed";
    closeSpan(w.job.span, this.now, outcome, result.ok ? null : result.cause);
    w.job.reply(result);
    this.startNext();
  }

  /** Cancelled work leaves without replying. */
  private drop(w: Work): void {
    this.leave(w);
    flagSpan(w.job.span, "cancelled");
    closeSpan(w.job.span, this.now, "failed", null);
    this.startNext();
  }

  private startNext(): void {
    while (this.busy < this.effectiveWorkers()) {
      const next = this.queue.shift();
      if (next === undefined) return;
      this.ctx.series.setQueueDepth(this.now, this.queue.length);
      this.start(next);
    }
  }
}

export function createServiceNode(spec: NodeSpec, ctx: NodeContext): NodeBehavior {
  return new ServiceNode(spec, ctx);
}
