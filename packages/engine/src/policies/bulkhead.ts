import { Fifo } from "../core/fifo";
import type { BulkheadPolicy } from "../model/types";

export interface BulkheadWaiter {
  readonly admit: () => void;
}

/**
 * Per-edge concurrency limit: at most `value` attempts in flight. With `waitingTaskQueue` excess
 * attempts wait in FIFO order (MicroProfile thread-pool style); when the queue is full, or there
 * is no queue, they are rejected with bulkhead-full.
 */
export class Bulkhead {
  private runningNow = 0;
  private readonly waiting = new Fifo<BulkheadWaiter>();
  private readonly queueLimit: number;

  constructor(private readonly policy: BulkheadPolicy) {
    this.queueLimit = policy.waitingTaskQueue ?? 0;
  }

  get running(): number {
    return this.runningNow;
  }

  get queued(): number {
    return this.waiting.length;
  }

  /** Admits (calling `waiter.admit` synchronously), queues or rejects the attempt. */
  enter(waiter: BulkheadWaiter): "admitted" | "queued" | "rejected" {
    if (this.runningNow < this.policy.value) {
      this.runningNow++;
      waiter.admit();
      return "admitted";
    }
    if (this.waiting.length < this.queueLimit) {
      this.waiting.push(waiter);
      return "queued";
    }
    return "rejected";
  }

  /** Releases a slot and admits the next waiter, if any. */
  leave(): void {
    this.runningNow--;
    const next = this.waiting.shift();
    if (next !== undefined) {
      this.runningNow++;
      next.admit();
    }
  }

  /** Removes a waiter that gave up (timeout or cancellation) before being admitted. */
  abandon(waiter: BulkheadWaiter): void {
    this.waiting.remove((w) => w === waiter);
  }
}
