"use client";

import { CircleHelp, Play, RotateCcw, SlidersHorizontal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EXAMPLES } from "@/lib/examples";
import { HonestyBanner } from "./honesty-banner";
import { BrandMark } from "./story-headline";

interface Props {
  file: string;
  onFile: (file: string) => void;
  running: { label: string; progress: number } | null;
  canRun: boolean;
  changes: number;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  fingerprint: string | null;
  /** Name of the user's own scenario, once there is one (it joins the picker). */
  customName: string | null;
  customOpen: boolean;
  onCustom: () => void;
  /** Opens the welcome screen again (what Fragor is, the tour). */
  onHelp: () => void;
}

/** Brand, scenario picker, run controls and the honesty note, on one line. */
export function TopBar({
  file,
  onFile,
  running,
  canRun,
  changes,
  onRun,
  onStop,
  onReset,
  fingerprint,
  customName,
  customOpen,
  onCustom,
  onHelp,
}: Props) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b py-3.5">
      <div className="flex items-center gap-2.5 text-lg font-bold tracking-wide">
        <BrandMark className="size-6" />
        Fragor
      </div>
      <Select value={file} onValueChange={onFile}>
        <SelectTrigger className="w-80 max-w-full" aria-label="Scenario">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EXAMPLES.map((e) => (
            <SelectItem key={e.file} value={e.file}>
              {e.title}
            </SelectItem>
          ))}
          {customName !== null && <SelectItem value="custom">Yours · {customName}</SelectItem>}
        </SelectContent>
      </Select>
      <Button
        variant={customOpen ? "secondary" : "outline"}
        onClick={onCustom}
        aria-expanded={customOpen}
        data-tour="your-scenario"
      >
        <SlidersHorizontal aria-hidden /> Your scenario
      </Button>
      {running === null ? (
        <Button onClick={onRun} disabled={!canRun}>
          <Play aria-hidden /> Run
          {changes > 0 ? ` with ${changes} change${changes === 1 ? "" : "s"}` : ""}
        </Button>
      ) : (
        <Button onClick={onStop} variant="secondary">
          <Square aria-hidden /> Stop
        </Button>
      )}
      <Button variant="outline" onClick={onReset} disabled={changes === 0} title="Reset parameters">
        <RotateCcw aria-hidden /> Reset
      </Button>
      {running !== null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-ok transition-[width]"
              style={{ width: `${Math.round(running.progress * 100)}%` }}
            />
          </div>
          Simulating {running.label}… {Math.round(running.progress * 100)}%
        </div>
      )}
      <div className="flex-1" />
      <Button variant="ghost" onClick={onHelp}>
        <CircleHelp aria-hidden /> How it works
      </Button>
      {fingerprint !== null && (
        <span
          className="font-mono text-[11px] text-dim"
          title={`Result fingerprint ${fingerprint}: same scenario + seed, same fingerprint`}
        >
          fingerprint {fingerprint.slice(0, 12)}
        </span>
      )}
      <HonestyBanner />
    </header>
  );
}
