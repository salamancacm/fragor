import { simulate } from "@fragor/engine";
import { describe, expect, it } from "vitest";
import { deriveEvents } from "../src/lib/events";
import { EXAMPLES } from "../src/lib/examples";
import { HELP, TOUR, troubleMoment } from "../src/lib/guide";
import { Playback } from "../src/lib/playback";

describe("guided tour", () => {
  it("has unique steps, each pointing at a different region, with text to read", () => {
    expect(new Set(TOUR.map((s) => s.id)).size).toBe(TOUR.length);
    expect(new Set(TOUR.map((s) => s.target)).size).toBe(TOUR.length);
    for (const s of TOUR) {
      expect(s.title.length).toBeGreaterThan(5);
      expect(s.body.length).toBeGreaterThan(40);
    }
    expect(TOUR[0]?.replay).toBe("start");
  });

  it("the trouble moment of example 01 is just after the slowdown starts", () => {
    const s = EXAMPLES[0]?.scenario;
    if (s === undefined) throw new Error("missing example");
    const t = troubleMoment(deriveEvents(s, simulate(s)));
    expect(t).toBe(11_500);
    expect(troubleMoment([])).toBe(0);
  });

  it("every help text is a full sentence", () => {
    for (const text of Object.values(HELP)) expect(text).toMatch(/^[A-Z0-9].{20,}\.$/);
  });
});

describe("playback.play", () => {
  it("resumes, and restarts when the replay had ended", () => {
    const pb = new Playback();
    pb.load(1000);
    pb.toggle();
    expect(pb.isPlaying).toBe(false);
    pb.play();
    expect(pb.isPlaying).toBe(true);
    pb.tick(1000);
    expect(pb.isPlaying).toBe(false);
    pb.play();
    expect(pb.timeMs).toBe(0);
    expect(pb.isPlaying).toBe(true);
  });
});
