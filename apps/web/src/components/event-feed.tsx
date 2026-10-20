"use client";

import { useEffect, useRef } from "react";
import type { FlowEvent } from "@/lib/events";
import { type Playback, usePlayback } from "@/lib/playback";
import { cn } from "@/lib/utils";
import { TONE_VAR } from "./transport";

interface Props {
  events: readonly FlowEvent[];
  playback: Playback;
  onSelect: (event: FlowEvent) => void;
}

/** Narrated events: past ones light up as the replay reaches them; click one to jump there. */
export function EventFeed({ events, playback, onSelect }: Props) {
  // Index of the latest event already reached (-1: none yet).
  const reached = usePlayback(playback, (p) => {
    let k = -1;
    for (let i = 0; i < events.length; i++) if ((events[i]?.tMs ?? 0) <= p.timeMs) k = i;
    return k;
  });
  const list = useRef<HTMLOListElement | null>(null);

  // Keep the latest event in view, scrolling the list only (never the page).
  useEffect(() => {
    const ol = list.current;
    const item = ol?.children[Math.max(0, reached)] as HTMLElement | undefined;
    if (ol === null || item === undefined) return;
    const top = item.offsetTop - ol.offsetTop;
    if (top < ol.scrollTop || top + item.offsetHeight > ol.scrollTop + ol.clientHeight)
      ol.scrollTo({ top: Math.max(0, top - ol.clientHeight / 3), behavior: "smooth" });
  }, [reached]);

  if (events.length === 0)
    return (
      <p className="px-4 text-sm text-muted-foreground">Nothing notable happened in this run.</p>
    );
  return (
    <ol
      ref={list}
      className="absolute inset-x-0 top-11 bottom-0 space-y-0.5 overflow-y-auto px-2 pb-3"
    >
      {events.map((e, i) => (
        <li key={`${e.tMs}-${e.title}`}>
          <button
            type="button"
            onClick={() => onSelect(e)}
            className={cn(
              "grid w-full grid-cols-[3rem_1fr] gap-2 rounded-lg px-2 py-2 text-left transition-[opacity,background-color,transform] duration-500 hover:bg-muted",
              i <= reached ? "opacity-100" : "opacity-30",
              i === reached && "translate-x-0.5 bg-muted",
            )}
          >
            <time className="pt-0.5 font-mono text-xs text-dim">{(e.tMs / 1000).toFixed(0)} s</time>
            <span>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: TONE_VAR[e.tone] }}
                />
                {e.title}
              </span>
              <span className="block text-xs text-muted-foreground">{e.detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
