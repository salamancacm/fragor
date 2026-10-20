"use client";

import type { Scenario, SimulationResult } from "@fragor/engine";
import { Pause, Play, RotateCcw } from "lucide-react";
import { type PointerEvent, useMemo, useRef } from "react";
import type { FlowEvent, Tone } from "@/lib/events";
import { type Playback, SPEEDS, usePlayback } from "@/lib/playback";

interface Props {
  scenario: Scenario;
  result: SimulationResult;
  events: readonly FlowEvent[];
  playback: Playback;
}

export const TONE_VAR: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  deg: "var(--deg)",
};

/** Outcome bars of every bucket (success, fallback, failed) as one SVG path per outcome. */
function outcomeBars(r: SimulationResult): { ok: string; deg: string; bad: string } {
  const g = r.series.global;
  const n = r.series.buckets;
  const total = (i: number) => (g.success[i] ?? 0) + (g.degraded[i] ?? 0) + (g.failed[i] ?? 0);
  const max = Math.max(1, ...Array.from({ length: n }, (_, i) => total(i)));
  const bar = (i: number, from: number, value: number) => {
    if (value <= 0) return "";
    const y0 = 40 - (from / max) * 38;
    const y1 = 40 - ((from + value) / max) * 38;
    return `M${i + 0.08},${y0}V${y1}H${i + 0.92}V${y0}Z`;
  };
  let ok = "";
  let deg = "";
  let bad = "";
  for (let i = 0; i < n; i++) {
    const s = g.success[i] ?? 0;
    const d = g.degraded[i] ?? 0;
    ok += bar(i, 0, s);
    deg += bar(i, s, d);
    bad += bar(i, s + d, g.failed[i] ?? 0);
  }
  return { ok, deg, bad };
}

/** Play, speed, a scrubbable timeline of outcomes with fault bands and event pins, and the clock. */
export function Transport({ scenario, result, events, playback }: Props) {
  const total = playback.totalMs;
  const playing = usePlayback(playback, (p) => p.isPlaying);
  const atEnd = usePlayback(playback, (p) => p.timeMs >= p.totalMs);
  const speed = usePlayback(playback, (p) => p.currentSpeed);
  const tenths = usePlayback(playback, (p) => Math.floor(p.timeMs / 100));
  const bars = useMemo(() => outcomeBars(result), [result]);
  const track = useRef<HTMLDivElement | null>(null);
  const n = result.series.buckets;
  const pctOf = (ms: number) => `${Math.min(100, (ms / total) * 100)}%`;

  const seekTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (r === undefined || r.width === 0) return;
    playback.seek(((e.clientX - r.left) / r.width) * total);
  };

  return (
    <div className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-4 pt-2">
      <button
        type="button"
        onClick={() => playback.toggle()}
        aria-label={playing ? "Pause" : atEnd ? "Replay" : "Play"}
        className="grid size-11 place-items-center rounded-full bg-foreground text-background hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {playing ? (
          <Pause className="size-4" fill="currentColor" />
        ) : atEnd ? (
          <RotateCcw className="size-4" />
        ) : (
          <Play className="size-4" fill="currentColor" />
        )}
      </button>
      <fieldset className="flex gap-0.5 rounded-lg bg-muted p-1" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            onClick={() => playback.setSpeed(s)}
            className="rounded-md px-2.5 py-1 font-mono text-xs text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
          >
            {s}×
          </button>
        ))}
      </fieldset>
      <div
        ref={track}
        className="relative h-14 cursor-pointer touch-none select-none"
        role="slider"
        tabIndex={0}
        aria-label="Replay time"
        aria-valuemin={0}
        aria-valuemax={total / 1000}
        aria-valuenow={tenths / 10}
        aria-valuetext={`${(tenths / 10).toFixed(1)} seconds`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10_000 : result.series.bucketMs;
          if (e.key === "ArrowRight") playback.seek(playback.timeMs + step);
          else if (e.key === "ArrowLeft") playback.seek(playback.timeMs - step);
          else if (e.key === " ") playback.toggle();
          else return;
          e.preventDefault();
        }}
      >
        <svg
          viewBox={`0 0 ${n} 40`}
          preserveAspectRatio="none"
          className="absolute inset-x-0 top-0 h-10 w-full"
          aria-hidden
        >
          {scenario.faults.map((f) => (
            <rect
              key={f.id}
              x={f.startMs / result.series.bucketMs}
              width={f.durationMs / result.series.bucketMs}
              y={0}
              height={40}
              fill="color-mix(in srgb, var(--warn) 16%, transparent)"
            />
          ))}
          <path d={bars.ok} fill="var(--ok)" opacity={0.85} />
          <path d={bars.deg} fill="var(--deg)" opacity={0.85} />
          <path d={bars.bad} fill="var(--bad)" opacity={0.85} />
        </svg>
        {events.map((e) => (
          <span
            key={`${e.tMs}-${e.title}`}
            title={`${(e.tMs / 1000).toFixed(0)} s · ${e.title}`}
            className="absolute top-11 size-1.5 -translate-x-1/2 rounded-full"
            style={{ left: pctOf(e.tMs), background: TONE_VAR[e.tone] }}
          />
        ))}
        <div
          className="absolute top-0 h-12 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: pctOf(tenths * 100) }}
        />
      </div>
      <div className="min-w-24 text-right font-mono text-xl font-semibold tabular-nums">
        {(tenths / 10).toFixed(1)} s{" "}
        <span className="text-xs font-normal text-dim">/ {total / 1000} s</span>
      </div>
    </div>
  );
}
