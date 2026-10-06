import type { MetricDelta, ResultComparison, SimulationSummary } from "@fragor/engine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { count, ms, pct } from "@/lib/format";

interface Props {
  summary: SimulationSummary;
  comparison: ResultComparison | null;
}

interface CardDef {
  key: string;
  label: string;
  value: (s: SimulationSummary) => string;
}

const rate = (n: number, s: SimulationSummary) => (s.roots === 0 ? null : n / s.roots);

const CARDS: CardDef[] = [
  { key: "successRate", label: "Success", value: (s) => pct(rate(s.success, s)) },
  { key: "degradedRate", label: "Degraded", value: (s) => pct(rate(s.degraded, s)) },
  { key: "failedRate", label: "Failed", value: (s) => pct(rate(s.failed, s)) },
  { key: "avgLatencyMs", label: "Avg latency", value: (s) => ms(s.avgLatencyMs) },
  { key: "p95Ms", label: "p95", value: (s) => ms(s.p95Ms) },
  { key: "p99Ms", label: "p99", value: (s) => ms(s.p99Ms) },
  { key: "retries", label: "Retries", value: (s) => count(s.retries) },
  { key: "timeouts", label: "Timeouts", value: (s) => count(s.timeouts) },
];

function formatDelta(m: MetricDelta): string {
  if (m.delta === null) return "";
  const sign = m.delta > 0 ? "+" : "";
  if (m.unit === "ratio") return `${sign}${(m.delta * 100).toFixed(1)} pp`;
  if (m.unit === "ms") return `${sign}${ms(m.delta)}`;
  return `${sign}${count(m.delta)}`;
}

const VERDICT_CLASS: Record<MetricDelta["verdict"], string> = {
  better: "text-emerald-700 dark:text-emerald-400",
  worse: "text-red-700 dark:text-red-400",
  same: "text-muted-foreground",
  "n/a": "text-muted-foreground",
};

/** Headline numbers of the run, each with its change against the previous run. */
export function SummaryCards({ summary, comparison }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {CARDS.map((c) => {
        const delta = comparison?.metrics.find((m) => m.key === c.key);
        return (
          <Card key={c.key} size="sm" className="gap-1">
            <CardHeader>
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold tabular-nums">{c.value(summary)}</div>
              {delta !== undefined && delta.delta !== null && delta.delta !== 0 ? (
                <div className={`text-xs tabular-nums ${VERDICT_CLASS[delta.verdict]}`}>
                  {formatDelta(delta)}{" "}
                  {delta.verdict === "better" || delta.verdict === "worse" ? delta.verdict : ""}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {comparison === null ? " " : "no change"}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
