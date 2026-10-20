import { simulate } from "@fragor/engine";
import { deriveFindings } from "@fragor/scenarios";
import { describe, expect, it } from "vitest";
import { deriveEvents } from "../src/lib/events";
import { EXAMPLES } from "../src/lib/examples";
import { linkFlow, stageLinks } from "../src/lib/flow";
import { ParticleField, requestsPerDot } from "../src/lib/particles";
import { bucketAt, Playback } from "../src/lib/playback";
import { lanePath, NODE_W, pointOn, stageLayout } from "../src/lib/stage-layout";
import { storyOf } from "../src/lib/story";

const example = (file: string) => {
  const e = EXAMPLES.find((x) => x.file === file);
  if (e === undefined) throw new Error(`missing example ${file}`);
  return e.scenario;
};
const s01 = example("01-payment-slow-baseline");
const s02 = example("02-payment-slow-with-breaker");
const s03 = example("03-cascade-blast-radius");
const r01 = simulate(s01);
const r02 = simulate(s02);
const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

describe("stage links and flows", () => {
  it("adds one traffic link per entry node, then the edges", () => {
    const ids = stageLinks(s03).map((l) => l.id);
    expect(ids).toEqual(["traffic:gateway", "gateway-users", "gateway-orders", "order-payment"]);
  });

  it("a link's flow adds up to the series it comes from", () => {
    const links = stageLinks(s01);
    const op = links.find((l) => l.id === "order-payment");
    if (op === undefined) throw new Error("missing link");
    expect(op.policies).toEqual(["timeout 2s", "3 retries"]);
    const e = r01.series.edges["order-payment"];
    for (let i = 0; i < r01.series.buckets; i++) {
      const f = linkFlow(r01, op, i);
      expect(f.sent + f.rejected).toBe(e?.attempts[i]);
    }
    const entry = links[0];
    if (entry === undefined) throw new Error("missing entry link");
    const g = r01.series.nodes.gateway;
    const total = (k: "sent" | "rejected") =>
      Array.from({ length: r01.series.buckets }, (_, i) => linkFlow(r01, entry, i)[k]).reduce(
        (a, b) => a + b,
        0,
      );
    expect(total("sent") + total("rejected")).toBe(g?.arrivals.reduce((a, b) => a + b, 0));
  });

  it("reports the breaker state on links that have one", () => {
    const op = stageLinks(s02).find((l) => l.id === "order-payment");
    if (op === undefined) throw new Error("missing link");
    expect(op.hasBreaker).toBe(true);
    const states = Array.from(
      { length: r02.series.buckets },
      (_, i) => linkFlow(r02, op, i).breaker,
    );
    expect(states).toContain("open");
  });
});

describe("stage layout", () => {
  it("puts the traffic source left of its entry node and callers left of callees", () => {
    const l = stageLayout(s03);
    const src = l.boxes["source:gateway"];
    const gw = l.boxes.gateway;
    const users = l.boxes["user-service"];
    const orders = l.boxes["order-service"];
    const pay = l.boxes["payment-service"];
    if (!src || !gw || !users || !orders || !pay) throw new Error("missing box");
    expect(src.x + src.w).toBeLessThan(gw.x);
    expect(gw.x + NODE_W).toBeLessThan(users.x);
    expect(users.x).toBe(orders.x);
    expect(users.y).not.toBe(orders.y);
    expect(orders.x + NODE_W).toBeLessThan(pay.x);
    for (const b of Object.values(l.boxes)) {
      expect(b.x + b.w).toBeLessThanOrEqual(l.width);
      expect(b.y + b.h).toBeLessThanOrEqual(l.height);
    }
  });

  it("link curves start and end on the boxes' sides", () => {
    const l = stageLayout(s03);
    for (const g of l.links) {
      const a = l.boxes[g.link.from];
      const b = l.boxes[g.link.to];
      if (!a || !b) throw new Error("missing box");
      expect(pointOn(g, 0)).toEqual({ x: a.x + a.w, y: a.y + a.h / 2 });
      expect(pointOn(g, 1)).toEqual({ x: b.x, y: b.y + b.h / 2 });
      expect(lanePath(g, -12)).toMatch(/^M[\d.]+,[\d.]+ [CL]/);
      // Monotonic left to right, so dots never travel backwards.
      for (let t = 0.05; t <= 1; t += 0.05)
        expect(pointOn(g, t).x).toBeGreaterThanOrEqual(pointOn(g, t - 0.05).x);
    }
  });
});

describe("events", () => {
  it("narrates the cascade of example 01 in time order", () => {
    const ev = deriveEvents(s01, r01);
    const titles = ev.map((e) => `${e.tMs / 1000}s ${e.title}`);
    expect(titles[0]).toBe("10s Fault: External Payment API");
    expect(titles).toEqual(
      expect.arrayContaining([
        "11s Payment Service saturated",
        "11s Order Service saturated",
        "12s API Gateway saturated",
        "40s Fault over: External Payment API",
      ]),
    );
    expect(titles.some((t) => t.includes("Retry storm on Order Service → Payment Service"))).toBe(
      true,
    );
    expect(titles.some((t) => t.endsWith("Users see errors"))).toBe(true);
    for (let k = 1; k < ev.length; k++)
      expect(ev[k]?.tMs ?? 0).toBeGreaterThanOrEqual(ev[k - 1]?.tMs ?? 0);
  });

  it("narrates the breaker of example 02 opening and probing", () => {
    const titles = deriveEvents(s02, r02).map((e) => e.title);
    expect(titles).toContain("Circuit breaker open on Order Service → Payment Service");
    expect(titles).toContain("Circuit breaker half-open on Order Service → Payment Service");
    expect(titles).not.toContain("Users see errors");
  });
});

describe("story", () => {
  it("tells example 01 from its numbers", () => {
    const parts = storyOf(s01, r01, deriveFindings(s01, r01));
    expect(text(parts)).toBe(
      "External Payment API got 5 s slower from 10 s to 40 s. Saturation climbed Payment Service → Order Service → API Gateway up to the entry point, and 50.8% of requests failed.",
    );
    expect(parts.find((p) => p.tone === "bad")?.text).toBe("50.8% of requests failed");
  });

  it("tells example 02: nothing failed, the fallback served the rest", () => {
    const parts = storyOf(s02, r02, deriveFindings(s02, r02));
    const t = text(parts);
    expect(t).toContain("but no request failed: 60.0% were served by a fallback.");
    expect(parts.map((p) => p.tone)).toEqual(expect.arrayContaining(["ok", "deg"]));
  });

  it("describes a traffic spike when there is no fault", () => {
    const s05 = example("05-traffic-spike-10x");
    const r05 = simulate(s05);
    expect(text(storyOf(s05, r05, deriveFindings(s05, r05)))).toMatch(
      /^Traffic jumped from 60 to 600 req\/s at 20 s, for 10 s\./,
    );
  });
});

describe("playback", () => {
  it("advances at the chosen speed, stops at the end and replays from the start", () => {
    const pb = new Playback();
    pb.load(10_000);
    pb.setSpeed(4);
    expect(pb.tick(1000)).toBe(4000);
    expect(bucketAt(pb.timeMs, 1000, 10)).toBe(4);
    pb.tick(5000);
    expect(pb.timeMs).toBe(10_000);
    expect(pb.isPlaying).toBe(false);
    expect(bucketAt(pb.timeMs, 1000, 10)).toBe(9);
    pb.toggle();
    expect(pb.timeMs).toBe(0);
    expect(pb.isPlaying).toBe(true);
  });

  it("notifies subscribers", () => {
    const pb = new Playback();
    let calls = 0;
    const off = pb.subscribe(() => calls++);
    pb.seek(5);
    off();
    pb.seek(6);
    expect(calls).toBe(1);
  });
});

describe("particles", () => {
  it("spawn in proportion to the flow and are reproducible", () => {
    const flow = { sent: 100, rejected: 20, ok: 60, degraded: 0, failed: 40, timeouts: 0 };
    const make = () => {
      const f = new ParticleField(7, requestsPerDot(100, 1000), 1000);
      for (let k = 0; k < 10; k++) f.spawn([{ ...flow, amplification: null, breaker: null }], 0.1);
      return f.particles;
    };
    const a = make();
    // 100 requests per second at 100/70 requests per dot: about 70 dots in one second.
    const n = (k: string) => a.filter((p) => p.kind === k).length;
    expect(Math.abs(n("request") - 70)).toBeLessThanOrEqual(1);
    expect(Math.abs(n("rejected") - 14)).toBeLessThanOrEqual(1);
    expect(Math.abs(n("response") - 70)).toBeLessThanOrEqual(1);
    expect(make()).toEqual(a);
  });

  it("dots leave once they arrive", () => {
    const f = new ParticleField(1, 1, 1000);
    f.spawn(
      [
        {
          sent: 10,
          rejected: 0,
          ok: 0,
          degraded: 0,
          failed: 0,
          timeouts: 0,
          amplification: null,
          breaker: null,
        },
      ],
      1,
    );
    expect(f.particles.length).toBe(10);
    f.step(1);
    expect(f.particles.length).toBe(0);
  });
});
