import { EventQueue, type QueueEntry } from "../core/event-queue";
import type { EventInfo, EventKind, Ms } from "../model/types";

export interface ScheduledEvent extends QueueEntry {
  readonly kind: EventKind;
  readonly fire: () => void;
  cancelled: boolean;
}

/**
 * Discrete-event kernel: virtual clock plus a (timeMs, seq) priority queue.
 * Cancellation is lazy (the event stays in the heap and is skipped when popped).
 * METRICS_TICK events do not count as pending work, so they never keep a run alive.
 */
export class Scheduler {
  private readonly queue = new EventQueue<ScheduledEvent>();
  private seq = 0;
  private now: Ms = 0;
  private pendingWork = 0;
  private processed = 0;
  private lastWork: Ms = 0;

  constructor(
    private readonly beforeEvent: (timeMs: Ms) => void,
    private readonly onEvent: ((event: EventInfo) => void) | undefined,
  ) {}

  get nowMs(): Ms {
    return this.now;
  }

  get eventsProcessed(): number {
    return this.processed;
  }

  /** Time of the last processed event other than METRICS_TICK. */
  get lastWorkMs(): Ms {
    return this.lastWork;
  }

  hasPendingWork(): boolean {
    return this.pendingWork > 0;
  }

  schedule(atMs: Ms, kind: EventKind, fire: () => void): ScheduledEvent {
    if (!Number.isFinite(atMs) || atMs < this.now) {
      throw new Error(`cannot schedule ${kind} at ${atMs}: virtual time is ${this.now}`);
    }
    const event: ScheduledEvent = { timeMs: atMs, seq: this.seq++, kind, fire, cancelled: false };
    this.queue.push(event);
    if (kind !== "METRICS_TICK") this.pendingWork++;
    return event;
  }

  cancel(event: ScheduledEvent): void {
    if (event.cancelled) return;
    event.cancelled = true;
    if (event.kind !== "METRICS_TICK") this.pendingWork--;
  }

  /** Processes every event with timeMs <= limitMs, then sets the clock to limitMs. */
  runUntil(limitMs: Ms): void {
    for (;;) {
      const next = this.queue.peek();
      if (next === undefined || next.timeMs > limitMs) break;
      this.queue.pop();
      if (next.cancelled) continue;
      this.now = next.timeMs;
      if (next.kind !== "METRICS_TICK") {
        this.pendingWork--;
        this.lastWork = next.timeMs;
      }
      // Mark consumed so a stale reference cannot cancel or re-fire it.
      next.cancelled = true;
      this.beforeEvent(next.timeMs);
      next.fire();
      this.processed++;
      this.onEvent?.({ timeMs: next.timeMs, seq: next.seq, kind: next.kind });
    }
    if (limitMs > this.now) this.now = limitMs;
  }
}
