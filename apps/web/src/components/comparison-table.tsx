import type { MetricDelta, ResultComparison } from "@fragor/engine";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { count, ms, pct } from "@/lib/format";

function value(m: MetricDelta, v: number | null): string {
  switch (m.unit) {
    case "ratio":
      return pct(v);
    case "ms":
      return ms(v);
    case "rps":
      return v === null ? "–" : `${v.toFixed(1)} rps`;
    case "count":
      return count(v);
  }
}

function delta(m: MetricDelta): string {
  if (m.delta === null || m.delta === 0) return "";
  const sign = m.delta > 0 ? "+" : "";
  if (m.unit === "ratio") return `${sign}${(m.delta * 100).toFixed(1)} pp`;
  if (m.unit === "ms") return `${sign}${ms(m.delta)}`;
  if (m.unit === "rps") return `${sign}${m.delta.toFixed(1)}`;
  return `${sign}${count(m.delta)}`;
}

const VERDICT_CLASS: Record<MetricDelta["verdict"], string> = {
  better: "text-emerald-700 dark:text-emerald-400",
  worse: "text-red-700 dark:text-red-400",
  same: "",
  "n/a": "",
};

/** Before (previous run) vs after (current run), computed by the engine's compareResults. */
export function ComparisonTable({
  comparison,
  labels,
}: {
  comparison: ResultComparison;
  labels: [string, string];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead className="text-right">Before: {labels[0]}</TableHead>
          <TableHead className="text-right">After: {labels[1]}</TableHead>
          <TableHead className="text-right">Change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comparison.metrics.map((m) => (
          <TableRow key={m.key}>
            <TableCell>{m.label}</TableCell>
            <TableCell className="text-right tabular-nums">{value(m, m.before)}</TableCell>
            <TableCell className="text-right tabular-nums">{value(m, m.after)}</TableCell>
            <TableCell className={`text-right tabular-nums ${VERDICT_CLASS[m.verdict]}`}>
              {delta(m)} {m.verdict === "better" || m.verdict === "worse" ? m.verdict : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
