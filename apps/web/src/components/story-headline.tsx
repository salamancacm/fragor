import type { StoryPart } from "@/lib/story";
import { HelpTip } from "./guide/help-tip";
import { TONE_VAR } from "./transport";

/** The run in one paragraph; the numbers that matter carry their color (and stay plain text). */
export function StoryHeadline({ parts }: { parts: readonly StoryPart[] }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
        What happened
        <HelpTip topic="story" label="this summary" />
      </p>
      <p className="mt-1.5 max-w-5xl text-2xl leading-snug font-semibold text-balance">
        {parts.map((p, i) =>
          p.tone === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are a fixed sequence per render
            <span key={i}>{p.text}</span>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are a fixed sequence per render
            <strong key={i} className="font-semibold" style={{ color: TONE_VAR[p.tone] }}>
              {p.text}
            </strong>
          ),
        )}
      </p>
    </div>
  );
}

/** Fragor's mark: a hexagon cracked through. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 26" className={className} aria-hidden>
      <path
        d="M13 2 23 7.5v11L13 24 3 18.5v-11Z"
        fill="none"
        stroke="var(--brand)"
        strokeWidth={2}
      />
      <path
        d="M13 2 11 10l5 3-4 11"
        fill="none"
        stroke="var(--brand)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
