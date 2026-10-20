"use client";

import { useSyncExternalStore } from "react";

export const SPEEDS = [1, 4, 10] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Replay clock of a finished run, kept outside React: the animation loop ticks it every frame and
 * components subscribe to coarse values (the current bucket), so the page does not re-render at
 * 60 fps. Time is simulated milliseconds.
 */
export class Playback {
  private t = 0;
  private total = 1;
  private speed: Speed = 4;
  private playing = true;
  private readonly listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get timeMs(): number {
    return this.t;
  }
  get totalMs(): number {
    return this.total;
  }
  get currentSpeed(): Speed {
    return this.speed;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  /** A new run: rewind and play from the start. */
  load(totalMs: number): void {
    this.total = Math.max(1, totalMs);
    this.t = 0;
    this.playing = true;
    this.emit();
  }

  /** Advances by `dtRealMs` of wall time; stops at the end. Returns simulated ms advanced. */
  tick(dtRealMs: number): number {
    if (!this.playing) return 0;
    const before = this.t;
    this.t = Math.min(this.total, this.t + dtRealMs * this.speed);
    if (this.t >= this.total) this.playing = false;
    this.emit();
    return this.t - before;
  }

  seek(ms: number): void {
    this.t = Math.max(0, Math.min(this.total, ms));
    this.emit();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.emit();
  }

  /** Play from the start again when at the end. */
  toggle(): void {
    if (!this.playing && this.t >= this.total) this.t = 0;
    this.playing = !this.playing;
    this.emit();
  }
}

/** Subscribes a component to a derived value; it re-renders only when that value changes. */
export function usePlayback<T>(pb: Playback, select: (pb: Playback) => T): T {
  return useSyncExternalStore(
    pb.subscribe,
    () => select(pb),
    () => select(pb),
  );
}

/** Bucket index shown at playback time `t`. */
export const bucketAt = (t: number, bucketMs: number, buckets: number): number =>
  Math.max(0, Math.min(buckets - 1, Math.floor(t / bucketMs)));
