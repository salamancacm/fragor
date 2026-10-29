import type { Evidence, Finding, Severity } from "@fragor/scenarios";
import { ChevronRight } from "lucide-react";
import { seconds } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  findings: readonly Finding[];
  /** Jump the replay to the evidence and highlight its target. */
  onEvidence: (evidence: Evidence) => void;
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "bg-bad/15 text-bad",
  warning: "bg-warn/15 text-warn",
  info: "bg-ok/15 text-ok",
};

function target(e: Evidence): string {
  if ("nodeId" in e) return e.nodeId;
  if ("edgeId" in e) return e.edgeId;
  return `trace ${e.traceId}`;
}

/** Rule-based findings (deterministic, no AI): title first, the numbers behind it on demand. */
export function Insights({ findings, onEvidence }: Props) {
  if (findings.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No findings: no rule fired for this run.</p>
    );
  return (
    <ul className="divide-y">
      {findings.map((f) => {
        const first = f.evidence.reduce<Evidence | undefined>(
          (a, e) => (a === undefined || e.fromMs < a.fromMs ? e : a),
          undefined,
        );
        return (
          <li key={f.id}>
            <details className="group py-2.5">
              <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 shrink-0 text-dim transition-transform group-open:rotate-90"
                  aria-hidden
                />
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] font-medium capitalize",
                    SEVERITY_CLASS[f.severity],
                  )}
                >
                  {f.severity}
                </span>
                <span className="flex-1 text-sm font-semibold">{f.title}</span>
                {first !== undefined && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.preventDefault();
                      onEvidence(first);
                    }}
                    className="shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                    title="Replay from this moment"
                  >
                    at {seconds(first.fromMs)} ▸
                  </button>
                )}
              </summary>
              <p className="mt-2 ml-7 text-sm text-muted-foreground">{f.summary}</p>
              <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                {f.evidence.map((e) => (
                  <button
                    key={`${target(e)}-${e.metric}-${e.fromMs}`}
                    type="button"
                    onClick={() => onEvidence(e)}
                    className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    title="Show this moment in the replay"
                  >
                    {target(e)} · {e.metric}
                    {e.value === null ? "" : ` = ${+e.value.toFixed(3)}`} · {seconds(e.fromMs)}–
                    {seconds(e.toMs)}
                  </button>
                ))}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
