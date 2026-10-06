import { describe, expect, it } from "vitest";
import { Bulkhead } from "../../src/policies/bulkhead";

describe("bulkhead", () => {
  it("admits up to value, queues up to waitingTaskQueue, rejects the rest", () => {
    const b = new Bulkhead({ value: 2, waitingTaskQueue: 1 });
    const admitted: string[] = [];
    const waiter = (id: string) => ({ admit: () => void admitted.push(id) });
    expect(b.enter(waiter("a"))).toBe("admitted");
    expect(b.enter(waiter("b"))).toBe("admitted");
    expect(b.enter(waiter("c"))).toBe("queued");
    expect(b.enter(waiter("d"))).toBe("rejected");
    b.leave();
    expect(admitted).toEqual(["a", "b", "c"]);
    expect([b.running, b.queued]).toEqual([2, 0]);
  });

  it("without waitingTaskQueue it is a plain semaphore", () => {
    const b = new Bulkhead({ value: 1 });
    expect(b.enter({ admit: () => {} })).toBe("admitted");
    expect(b.enter({ admit: () => {} })).toBe("rejected");
  });

  it("an abandoned waiter is never admitted", () => {
    const b = new Bulkhead({ value: 1, waitingTaskQueue: 5 });
    b.enter({ admit: () => {} });
    let ran = false;
    const waiter = {
      admit: () => {
        ran = true;
      },
    };
    b.enter(waiter);
    b.abandon(waiter);
    b.leave();
    expect(ran).toBe(false);
    expect(b.running).toBe(0);
  });
});
