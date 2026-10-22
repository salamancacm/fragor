"use client";

import { Flame, GitCompareArrows, Network, Play, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "../story-headline";

interface Props {
  onTour: () => void;
  onOwn: () => void;
  onSkip: () => void;
}

const STEPS = [
  {
    icon: Network,
    title: "Describe your system",
    body: "Your services, how many threads they have, how fast they answer, and their timeouts and retries.",
  },
  {
    icon: Flame,
    title: "Break something",
    body: "A dependency gets slow, returns errors or goes down. Or traffic spikes.",
  },
  {
    icon: GitCompareArrows,
    title: "Watch, understand, compare",
    body: "See the trouble spread, read why it happened, then try a fix (a circuit breaker, fewer retries) and compare.",
  },
] as const;

/** First visit: what Fragor is, in three steps, and two ways to start. */
export function Welcome({ onTour, onOwn, onSkip }: Props) {
  const primary = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/85 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="w-full max-w-3xl rounded-3xl border bg-card p-6 shadow-2xl sm:p-10"
      >
        <div className="flex items-center gap-2.5 text-lg font-bold tracking-wide">
          <BrandMark className="size-7" />
          Fragor
        </div>
        <h1
          id="welcome-title"
          className="mt-6 text-3xl leading-tight font-semibold text-balance sm:text-4xl"
        >
          See what happens to your system when something breaks,{" "}
          <span className="text-brand">before it happens.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Fragor simulates microservices under failure: a slow payment API, a traffic spike, a
          service going down. You watch the trouble spread from service to service, see why, and
          test which fix works. It runs in your browser: nothing to install, nothing is sent
          anywhere.
        </p>

        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-brand/15 font-mono text-xs font-bold text-brand">
                  {i + 1}
                </span>
                <s.icon className="size-4 text-muted-foreground" aria-hidden />
              </div>
              <h2 className="mt-3 text-sm font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button ref={primary} size="lg" onClick={onTour} className="h-11 px-5 text-base">
            <Play aria-hidden /> Show me with an example
          </Button>
          <Button size="lg" variant="outline" onClick={onOwn} className="h-11 px-5 text-base">
            <SlidersHorizontal aria-hidden /> Model my own service
          </Button>
          <button
            type="button"
            onClick={onSkip}
            className="px-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Skip, I'll explore
          </button>
        </div>
        <p className="mt-6 text-xs text-dim">
          A simulation of the numbers you assume, not a prediction: use it to understand mechanisms
          and compare options.
        </p>
      </div>
    </div>
  );
}
