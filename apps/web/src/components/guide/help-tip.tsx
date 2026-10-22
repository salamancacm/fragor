"use client";

import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HELP, type HelpKey } from "@/lib/guide";

/** A small "?" that explains a part of the page in plain words (hover, focus or tap). */
export function HelpTip({ topic, label }: { topic: HelpKey; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`What is ${label}?`}
          className="inline-grid size-4 shrink-0 place-items-center rounded-full align-middle text-dim hover:text-foreground focus-visible:text-foreground"
        >
          <CircleHelp className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-xs text-left leading-snug normal-case tracking-normal"
      >
        {HELP[topic]}
      </TooltipContent>
    </Tooltip>
  );
}
