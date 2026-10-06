import { compileDist, type Sampler } from "../core/distributions";
import { Fifo } from "../core/fifo";
import type { Rng } from "../core/rng";
import { closeSpan } from "../metrics/traces";
import type { NodeSnapshot, NodeSpec } from "../model/types";
import type { Job, JobResult, NodeBehavior, NodeContext } from "./node-behavior";

/**
 * Generic request/response service: `workers` concurrent jobs, a FIFO waiting queue bounded
 * by `queueLimit` (503 when full), own `serviceTime` and an `errorRate` of 500 responses.
 * Used for both "service" and "external-api" kinds.
 */
export class ServiceNode implements NodeBehavior {
  private readonly queue = new Fifo<Job>();
  private readonly serviceTime: Sampler;
  private readonly serviceRng: Rng;
  private readonly errorRng: Rng;
  private busy = 0;
  private arrivals = 0;
  private completed = 0;

  constructor(
    readonly spec: NodeSpec,
    private readonly ctx: NodeContext,
  ) {
    this.serviceTime = compileDist(spec.serviceTime, `nodes[${spec.id}].serviceTime`);
    this.serviceRng = ctx.stream("service");
    this.errorRng = ctx.stream("error");
    ctx.series.setEffectiveWorkers(0, this.effectiveWorkers());
  }

  arrive(job: Job): void {
    const now = this.ctx.scheduler.nowMs;
    this.arrivals++;
    this.ctx.series.inc("arrivals");
    if (this.busy < this.effectiveWorkers()) {
      this.start(job);
    } else if (this.spec.queueLimit === null || this.queue.length < this.spec.queueLimit) {
      this.queue.push(job);
      this.ctx.series.setQueueDepth(now, this.queue.length);
    } else {
      this.ctx.series.inc("rejected503");
      this.respond(job, { ok: false, failure: "http-5xx" });
    }
  }

  snapshot(): NodeSnapshot {
    return {
      arrivals: this.arrivals,
      completed: this.completed,
      inService: this.busy,
      queueDepth: this.queue.length,
      waitingOnDependencies: 0,
      effectiveWorkers: this.effectiveWorkers(),
      busyWorkers: this.busy,
    };
  }

  private effectiveWorkers(): number {
    return this.spec.workers;
  }

  private start(job: Job): void {
    const { scheduler, series } = this.ctx;
    this.busy++;
    series.setBusy(scheduler.nowMs, this.busy);
    const duration = this.serviceTime(this.serviceRng);
    scheduler.schedule(scheduler.nowMs + duration, "SERVICE_DONE", () => this.serviceDone(job));
  }

  private serviceDone(job: Job): void {
    // Always draw, so changing errorRate never shifts the rest of this stream.
    const u = this.errorRng.next();
    const result: JobResult =
      u < this.spec.errorRate ? { ok: false, failure: "http-5xx" } : { ok: true };
    this.releaseWorker();
    this.respond(job, result);
    this.startNext();
  }

  private releaseWorker(): void {
    this.busy--;
    this.ctx.series.setBusy(this.ctx.scheduler.nowMs, this.busy);
  }

  private startNext(): void {
    while (this.busy < this.effectiveWorkers()) {
      const next = this.queue.shift();
      if (next === undefined) return;
      this.ctx.series.setQueueDepth(this.ctx.scheduler.nowMs, this.queue.length);
      this.start(next);
    }
  }

  private respond(job: Job, result: JobResult): void {
    const now = this.ctx.scheduler.nowMs;
    this.completed++;
    this.ctx.series.inc(result.ok ? "success" : "failed");
    this.ctx.series.recordLatency(now - job.arrivedAtMs);
    closeSpan(job.span, now, result.ok ? "success" : "failed", result.ok ? null : result.failure);
    job.reply(result);
  }
}

export function createServiceNode(spec: NodeSpec, ctx: NodeContext): NodeBehavior {
  return new ServiceNode(spec, ctx);
}
