import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EventQueue } from "../../src/core/event-queue";

describe("EventQueue", () => {
  it("pops in (timeMs, seq) order for any insertion order", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 300 }), (times) => {
        const q = new EventQueue<{ timeMs: number; seq: number }>();
        for (const [seq, timeMs] of times.entries()) q.push({ timeMs, seq });
        const out: { timeMs: number; seq: number }[] = [];
        for (let e = q.pop(); e !== undefined; e = q.pop()) out.push(e);
        const expected = times
          .map((timeMs, seq) => ({ timeMs, seq }))
          .sort((a, b) => a.timeMs - b.timeMs || a.seq - b.seq);
        expect(out).toEqual(expected);
      }),
    );
  });

  it("breaks ties on time by insertion sequence", () => {
    const q = new EventQueue<{ timeMs: number; seq: number }>();
    q.push({ timeMs: 5, seq: 2 });
    q.push({ timeMs: 5, seq: 0 });
    q.push({ timeMs: 5, seq: 1 });
    expect([q.pop()?.seq, q.pop()?.seq, q.pop()?.seq]).toEqual([0, 1, 2]);
    expect(q.pop()).toBeUndefined();
  });
});
