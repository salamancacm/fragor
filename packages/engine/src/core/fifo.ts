/** FIFO queue with O(1) amortized push and shift. */
export class Fifo<T> {
  private items: (T | undefined)[] = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }

  push(item: T): void {
    this.items.push(item);
  }

  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head++;
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }

  /** Removes the first item matching `predicate`. O(n); used only for cancellation. */
  remove(predicate: (item: T) => boolean): T | undefined {
    for (let i = this.head; i < this.items.length; i++) {
      const item = this.items[i];
      if (item !== undefined && predicate(item)) {
        this.items.splice(i, 1);
        return item;
      }
    }
    return undefined;
  }
}
