import type { Evidence, Finding, Severity } from "@fragor/scenarios";
import { Badge } from "@/components/ui/badge";
import { seconds } from "@/lib/format";

interface Props {
  findings: readonly Finding[];
  /** Jump the time slider and highlight the evidence target. */
  onEvidence: (evidence: Evidence) => void;
}

const SEVERITY_VARIANT: Record<Severity, "destructive" | "secondary" | "outline"> = {
  critical: "destructive",
  warning: "secondary",
  info: "outline",
};

function target(e: Evidence): string {
  if ("nodeId" in e) return e.nodeId;
  if ("edgeId" in e) return e.edgeId;
  return `trace ${e.traceId}`;
}

/** Rule-based findings computed from this run (deterministic, no AI). */
export function Insights({ findings, onEvidence }: Props) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No findings: no rule fired for this run.</p>
    );
  }
  return (
    <ul className="space-y-3">
      {findings.map((f) => (
        <li key={f.id} className="rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity}</Badge>
            <span className="font-medium">{f.title}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{f.summary}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {f.evidence.map((e) => (
              <button
                key={`${target(e)}-${e.metric}-${e.fromMs}`}
                type="button"
                onClick={() => onEvidence(e)}
                className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                title="Show this moment in the graph and charts"
              >
                {target(e)} · {e.metric}
                {e.value === null ? "" : ` = ${e.value}`} · {seconds(e.fromMs)}–{seconds(e.toMs)}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
