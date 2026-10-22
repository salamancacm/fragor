"use client";

import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TourStep } from "@/lib/guide";

interface Props {
  steps: readonly TourStep[];
  /** Called when a step is shown, so the page can move the replay. */
  onStep: (step: TourStep) => void;
  onClose: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const CARD_W = 360;

function measure(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

/** Card below the spotlight when it fits, else above, else inside its bottom; clamped to the viewport. */
function cardPosition(r: Rect, cardH: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(12, Math.min(vw - CARD_W - 12, r.left));
  if (r.top + r.height + 12 + cardH < vh) return { top: r.top + r.height + 12, left };
  if (r.top - 12 - cardH > 0) return { top: r.top - 12 - cardH, left };
  return { top: Math.max(12, Math.min(vh - cardH - 12, r.top + r.height - cardH - 12)), left };
}

/**
 * A step-by-step tour: dims the page, outlines one region at a time and explains it. Keyboard:
 * arrows move, Escape closes. The page stays usable underneath only through the tour's buttons.
 */
export function Tour({ steps, onStep, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(220);
  const card = useRef<HTMLDivElement | null>(null);
  const step = steps[index];

  const update = useCallback(() => {
    if (step !== undefined) setRect(measure(step.target));
  }, [step]);

  // New step: scroll its region into view, move the replay, then measure.
  useEffect(() => {
    if (step === undefined) return;
    onStep(step);
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = window.setTimeout(update, 450);
    card.current?.focus();
    return () => window.clearTimeout(t);
  }, [step, onStep, update]);

  useEffect(() => {
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [update]);

  useLayoutEffect(() => {
    if (card.current !== null) setCardH(card.current.offsetHeight);
  });

  const go = useCallback(
    (d: number) => {
      const next = index + d;
      if (next < 0) return;
      if (next >= steps.length) onClose();
      else setIndex(next);
    },
    [index, steps.length, onClose],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (step === undefined) return null;
  const pos =
    rect === null
      ? { top: window.innerHeight / 2 - cardH / 2, left: window.innerWidth / 2 - CARD_W / 2 }
      : cardPosition(rect, cardH);
  const last = index === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50" aria-live="polite">
      {/* Dim everything but the spotlight (a huge shadow around it), and block clicks below. */}
      <div className="absolute inset-0" />
      {rect !== null && (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-brand transition-all duration-300"
          style={{ ...rect, boxShadow: "0 0 0 9999px rgb(5 8 12 / 0.72)" }}
        />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="absolute rounded-2xl border border-brand/50 bg-popover p-4 shadow-2xl outline-none transition-[top,left] duration-300"
        style={{ top: pos.top, left: pos.left, width: CARD_W }}
      >
        <div className="flex items-start gap-2">
          <p className="flex-1 font-mono text-[11px] text-brand">
            Step {index + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the tour"
            className="-mt-1 -mr-1 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-base font-semibold">
          {step.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1 flex-1 rounded-full ${i <= index ? "bg-brand" : "bg-muted"}`}
              />
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => go(-1)} disabled={index === 0}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          <Button size="sm" onClick={() => go(1)}>
            {last ? "Finish" : "Next"} {!last && <ArrowRight aria-hidden />}
          </Button>
        </div>
      </div>
    </div>
  );
}
