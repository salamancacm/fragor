"use client";

import type { SimulationResult } from "@fragor/engine";
import { useEffect, useRef } from "react";
import type { Tone } from "@/lib/events";
import { linkFlow } from "@/lib/flow";
import { ParticleField, requestsPerDot } from "@/lib/particles";
import { bucketAt, type Playback } from "@/lib/playback";
import { LANE, type LinkGeometry, labelParam, pointOn, type StageLayout } from "@/lib/stage-layout";

interface Props {
  layout: StageLayout;
  result: SimulationResult;
  playback: Playback;
}

/** Where a rejected dot stops: at the node's door (503), the breaker gate, or the caller (bulkhead). */
function rejectStop(g: LinkGeometry): number {
  if (g.link.kind === "traffic") return 0.92;
  return g.link.hasBreaker ? labelParam(g) : 0.2;
}

function peakFlow(layout: StageLayout, r: SimulationResult): number {
  let peak = 1;
  for (const g of layout.links)
    for (let i = 0; i < r.series.buckets; i++) {
      const f = linkFlow(r, g.link, i);
      peak = Math.max(peak, f.sent + f.rejected);
    }
  return peak;
}

/**
 * Animation loop of the stage: ticks the replay clock every frame and draws the flow as dots on a
 * canvas laid over the SVG. With reduced motion it keeps the clock running but draws no dots.
 */
export function ParticleCanvas({ layout, result, playback }: Props) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (el === null || el === undefined || ctx === null || ctx === undefined) return;
    const { bucketMs, buckets } = result.series;
    const field = new ParticleField(
      result.seed,
      requestsPerDot(peakFlow(layout, result), bucketMs),
      bucketMs,
    );
    const css = getComputedStyle(document.documentElement);
    const color: Record<Tone, string> = {
      ok: css.getPropertyValue("--ok").trim() || "#3fb6f2",
      warn: css.getPropertyValue("--warn").trim() || "#f5a524",
      bad: css.getPropertyValue("--bad").trim() || "#ff5a5f",
      deg: css.getPropertyValue("--deg").trim() || "#b48cf2",
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = performance.now();
    let lastT = playback.timeMs;
    let frame = 0;

    const draw = () => {
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (reduced.matches) return;
      const k = (rect.width / layout.width) * dpr;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.shadowBlur = 6;
      for (const q of field.particles) {
        const g = layout.links[q.link];
        if (g === undefined) continue;
        let p = q.p;
        let fall = 0;
        let alpha = 1;
        let lane = -LANE;
        if (q.kind === "response") {
          p = 1 - q.p;
          lane = LANE;
        } else if (q.kind === "rejected") {
          const stop = rejectStop(g);
          p = Math.min(q.p, stop);
          fall = Math.max(0, q.p - stop);
          alpha = Math.max(0, 1 - fall * 2.2);
        }
        const pt = pointOn(g, p, lane + q.jitter * 0.3);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color[q.tone];
        ctx.shadowColor = color[q.tone];
        ctx.beginPath();
        ctx.arc(
          pt.x,
          pt.y + fall * 120 + (q.kind === "rejected" ? q.jitter : 0),
          q.kind === "response" ? 2.6 : 3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      playback.tick(dt * 1000);
      // A jump (seek or replay) leaves old dots in the wrong place: start clean.
      if (Math.abs(playback.timeMs - lastT) > bucketMs * 2) field.clear();
      lastT = playback.timeMs;
      if (playback.isPlaying) {
        const i = bucketAt(playback.timeMs, bucketMs, buckets);
        field.spawn(
          layout.links.map((g) => linkFlow(result, g.link, i)),
          dt,
        );
        field.step(dt);
      }
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [layout, result, playback]);

  return (
    <canvas
      ref={canvas}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
