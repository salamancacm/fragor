"use client";

import type {
  MetricDelta,
  ResultComparison,
  SimulationResult,
  SimulationSummary,
} from "@fragor/engine";
import { ms } from "@/lib/format";
import { bucketAt, type Playback, usePlayback } from "@/lib/playback";
import { cn } from "@/lib/utils";

interface Props {
  result: SimulationResult;
  previous: SimulationResult | null;
  comparison: ResultComparison | null;
  playback: Playback;
}

type Better = "higher" | "lower" | "neither";

interface Kpi {
  label: string;
  value: string;
  /** Change against the previous run, already formatted, and whether it is good news. */
  delta: { text: string; verdict: "better" | "worse" | "same" } | null;
  series: readonly (number | null)[];
  color: string;
}

const pct = (n: number, s: SimulationSummary) => (s.roots === 0 ? 0 : n / s.roots);
const pp = (d: number) => `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)} pp`;

function fromComparison(
  c: ResultComparison | null,
  key: string,
  format: (d: number) => string,
): Kpi["delta"] {
  const m: MetricDelta | undefined = c?.metrics.find((x) => x.key === key);
  if (m === undefined || m.delta === null) return null;
  const verdict = m.verdict === "better" || m.verdict === "worse" ? m.verdict : "same";
  return { text: format(m.delta), verdict };
}

function manual(
  now: number,
  before: number | null,
  better: Better,
  format: (d: number) => string,
): Kpi["delta"] {
  if (before === null) return null;
  const d = now - before;
  const verdict =
    Math.abs(d) < 1e-9 || better === "neither"
      ? "same"
      : (better === "higher") === d > 0
        ? "better"
        : "worse";
  return { text: format(d), verdict };
}

/** Attempts per invocation over every edge, per bucket. */
function amplificationSeries(r: SimulationResult): (number | null)[] {
  const edges = Object.values(r.series.edges);
  return Array.from({ length: r.series.buckets }, (_, i) => {
    const calls = edges.reduce((a, e) => a + (e.arrivals[i] ?? 0), 0);
    return calls === 0 ? null : edges.reduce((a, e) => a + (e.attempts[i] ?? 0), 0) / calls;
  });
}

function amplification(s: SimulationSummary, r: SimulationResult): number {
  const calls = Object.values(r.series.edges).reduce(
    (a, e) => a + e.arrivals.reduce((x, y) => x + y, 0),
    0,
  );
  return calls === 0 ? 1 : s.attempts / calls;
}

function kpis(
  r: SimulationResult,
  prev: SimulationResult | null,
  c: ResultComparison | null,
): Kpi[] {
  const s = r.summary;
  const g = r.series.global;
  const amp = amplification(s, r);
  return [
    {
      label: "Success",
      value: `${(pct(s.success, s) * 100).toFixed(1)}%`,
      delta: fromComparison(c, "successRate", pp),
      series: g.success,
      color: "var(--ok)",
    },
    {
      label: "Served by fallback",
      value: `${(pct(s.degraded, s) * 100).toFixed(1)}%`,
      delta: fromComparison(c, "degradedRate", pp),
      series: g.degraded,
      color: "var(--deg)",
    },
    {
      label: "Failed",
      value: `${(pct(s.failed, s) * 100).toFixed(1)}%`,
      delta: fromComparison(c, "failedRate", pp),
      series: g.failed,
      color: "var(--bad)",
    },
    {
      label: "p99 latency",
      value: ms(s.p99Ms),
      delta: fromComparison(c, "p99Ms", (d) => `${d > 0 ? "+" : "−"}${ms(Math.abs(d))}`),
      series: g.p99Ms,
      color: "var(--warn)",
    },
    {
      label: "Load amplification",
      value: `×${amp.toFixed(2)}`,
      delta: manual(
        amp,
        prev === null ? null : amplification(prev.summary, prev),
        "lower",
        (d) => `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`,
      ),
      series: amplificationSeries(r),
      color: "var(--warn)",
    },
  ];
}

function Sparkline({
  values,
  color,
  playback,
  bucketMs,
}: {
  values: readonly (number | null)[];
  color: string;
  playback: Playback;
  bucketMs: number;
}) {
  const n = values.length;
  const bucket = usePlayback(playback, (p) => bucketAt(p.timeMs, bucketMs, n));
  const max = Math.max(1e-9, ...values.map((v) => v ?? 0));
  const pts = values.map((v, i) => `${i},${33 - ((v ?? 0) / max) * 29}`);
  return (
    <svg
      viewBox={`0 0 ${Math.max(1, n - 1)} 34`}
      preserveAspectRatio="none"
      className="mt-2 block h-9 w-full"
      aria-hidden
    >
      <path d={`M0,34 L${pts.join(" L")} L${n - 1},34 Z`} fill={color} opacity={0.12} />
      <path
        d={`M${pts.join(" L")}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={bucket}
        x2={bucket}
        y1={0}
        y2={34}
        stroke="var(--foreground)"
        opacity={0.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const VERDICT_CLASS = { better: "text-ok", worse: "text-bad", same: "text-dim" } as const;

/** The five numbers that tell the outcome, each with its shape over time and its change. */
export function KpiStrip({ result, previous, comparison, playback }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {kpis(result, previous, comparison).map((k) => (
        <div key={k.label} className="rounded-xl border bg-card px-4 pt-3.5 pb-2.5">
          <div className="text-xs text-muted-foreground">{k.label}</div>
          <div className="mt-1 font-mono text-[1.65rem] leading-tight font-semibold tabular-nums">
            {k.value}
          </div>
          <div
            className={cn(
              "font-mono text-xs",
              k.delta === null ? "text-dim" : VERDICT_CLASS[k.delta.verdict],
            )}
          >
            {k.delta === null ? "first run" : `${k.delta.text} vs previous run`}
          </div>
          <Sparkline
            values={k.series}
            color={k.color}
            playback={playback}
            bucketMs={result.series.bucketMs}
          />
        </div>
      ))}
    </div>
  );
}
