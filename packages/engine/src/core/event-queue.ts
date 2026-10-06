/**
 * Binary min-heap ordered by (timeMs, seq). `seq` is assigned by the caller from a
 * monotonic counter, so ties on time are broken deterministically by insertion order.
 */
export interface QueueEntry {
  readonly timeMs: number;
  readonly seq: number;
}

function before(a: QueueEntry, b: QueueEntry): boolean {
  return a.timeMs < b.timeMs || (a.timeMs === b.timeMs && a.seq < b.seq);
}

export class EventQueue<T extends QueueEntry> {
  private readonly heap: T[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(entry: T): void {
    const heap = this.heap;
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = heap[parent] as T;
      if (!before(entry, p)) break;
      heap[i] = p;
      i = parent;
    }
    heap[i] = entry;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  pop(): T | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined || heap.length === 0) return top;
    const n = heap.length;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      let child = l;
      if (r < n && before(heap[r] as T, heap[l] as T)) child = r;
      const c = heap[child] as T;
      if (!before(c, last)) break;
      heap[i] = c;
      i = child;
    }
    heap[i] = last;
    return top;
  }
}
