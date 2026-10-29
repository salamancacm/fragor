"use client";

import type { Scenario } from "@fragor/engine";
import {
  buildScenario,
  type ObservedSystem,
  observeTraces,
  parseObserved,
  parseOtlp,
  renderReport,
  rootRange,
  type Span,
  valueAt,
} from "@fragor/importers";
import type { PatchOp } from "@fragor/scenarios";
import { Download, FileUp, Play, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadText, safeName } from "@/lib/download";
import { REPO_URL } from "@/lib/links";
import { AnswerForm } from "./answer-form";

/** A bigger file would freeze the page while it is read; this is a few hundred thousand requests. */
const MAX_BYTES = 300_000_000;

type Loaded =
  | {
      kind: "traces";
      name: string;
      spans: Span[];
      range: { fromMs: number; toMs: number; requests: number } | null;
      unread: number;
    }
  | { kind: "observed"; name: string; observed: ObservedSystem };

const iso = (ms: number) => new Date(ms).toISOString();

/** Empty means "no bound"; otherwise a date and time; NaN when it is not one. */
function instant(text: string): number | undefined {
  const t = text.trim();
  return t === "" ? undefined : Date.parse(t);
}

async function read(file: File): Promise<{ loaded: Loaded } | { error: string }> {
  if (file.size > MAX_BYTES)
    return {
      error: `${file.name} is too large (${Math.round(file.size / 1e6)} MB). Cut it to a calm period first.`,
    };
  const text = await file.text();
  await new Promise((r) => setTimeout(r, 0)); // let "Reading…" paint before the heavy part
  const name = file.name.replace(/\.[^.]*$/, "") || "imported";
  const parsed = parseOtlp(text);
  if (parsed.spans.length > 0)
    return {
      loaded: {
        kind: "traces",
        name,
        spans: parsed.spans,
        range: rootRange(parsed.spans),
        unread: parsed.problems.length,
      },
    };
  try {
    const o = parseObserved(JSON.parse(text));
    if (o.ok) return { loaded: { kind: "observed", name, observed: o.observed } };
    return {
      error: `${file.name} is not OpenTelemetry traces, and as an observed system it has problems: ${o.errors.slice(0, 3).join("; ")}`,
    };
  } catch {
    return {
      error: `${file.name} has no OpenTelemetry traces (OTLP JSON, one document per line). ${parsed.problems[0] ?? ""}`,
    };
  }
}

/** Import tab: a file of OpenTelemetry traces becomes a draft scenario, and its open questions get answered here. */
export function ImportTraces({ onRun }: { onRun: (scenario: Scenario) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"idle" | "reading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [answers, setAnswers] = useState<Record<string, PatchOp[]>>({});
  const input = useRef<HTMLInputElement | null>(null);

  const open = async (file: File) => {
    setStatus("reading");
    setError(null);
    const r = await read(file);
    setStatus("idle");
    if ("error" in r) return setError(r.error);
    setLoaded(r.loaded);
    setAnswers({});
    setFrom("");
    setTo("");
  };

  const observed = useMemo(() => {
    if (loaded === null) return null;
    if (loaded.kind === "observed") return { observed: loaded.observed, warnings: [] as string[] };
    const fromMs = instant(from);
    const toMs = instant(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs))
      return { errors: ["The time range must be dates and times, like 2026-10-29T19:08:38Z."] };
    const r = observeTraces(loaded.spans, {
      name: loaded.name,
      source: `OpenTelemetry traces: ${loaded.name}`,
      ...(fromMs === undefined ? {} : { fromMs }),
      ...(toMs === undefined ? {} : { toMs }),
    });
    if (!r.ok) return { errors: r.errors };
    const unread =
      loaded.unread > 0 ? [`${loaded.unread} lines of the file could not be read.`] : [];
    return { observed: r.observed, warnings: [...unread, ...r.warnings] };
  }, [loaded, from, to]);

  const built = useMemo(() => {
    if (observed === null) return null;
    if ("errors" in observed) return { errors: observed.errors };
    const b = buildScenario(observed.observed, {
      answers: Object.values(answers).flat(),
      warnings: observed.warnings,
    });
    return b.ok ? { ...b, observed: observed.observed } : { errors: b.errors };
  }, [observed, answers]);

  const apply = (path: string, ops: PatchOp[]) => setAnswers((a) => ({ ...a, [path]: ops }));
  const undo = (path: string) =>
    setAnswers((a) => {
      const { [path]: _gone, ...rest } = a;
      return rest;
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Import the traces your services already produce (OpenTelemetry, OTLP JSON as the Collector's
        file exporter writes it). Fragor reads them in your browser, builds a draft of your system
        and tells you which numbers it measured and which are still placeholders. Use a{" "}
        <b>calm period</b>: response times include time waiting for a worker.{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={`${REPO_URL}/blob/main/docs/USAGE.md#importing-traces`}
          target="_blank"
          rel="noopener noreferrer"
        >
          How to get the file
        </a>
        .
      </p>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f !== undefined) void open(f);
        }}
        className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed p-6 text-sm text-muted-foreground hover:border-muted-foreground hover:text-foreground"
      >
        <FileUp className="size-5" aria-hidden />
        {status === "reading"
          ? "Reading…"
          : loaded === null
            ? "Drop a traces file here, or click to choose one"
            : `Loaded ${loaded.name}. Drop another file to replace it`}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,.jsonl,.ndjson,application/json"
        className="hidden"
        aria-label="Traces file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f !== undefined) void open(f);
        }}
      />
      {error !== null && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {error}
        </p>
      )}

      {loaded?.kind === "traces" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="import-from" className="text-xs font-normal text-muted-foreground">
              From (UTC, optional)
            </Label>
            <Input
              id="import-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder={loaded.range === null ? "" : iso(loaded.range.fromMs)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="import-to" className="text-xs font-normal text-muted-foreground">
              To (UTC, optional)
            </Label>
            <Input
              id="import-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={loaded.range === null ? "" : iso(loaded.range.toMs)}
            />
          </div>
          <p className="text-xs text-dim sm:col-span-2">
            {loaded.spans.length} spans
            {loaded.range === null
              ? ""
              : `, ${loaded.range.requests} requests from ${iso(loaded.range.fromMs)} to ${iso(loaded.range.toMs)}`}
            . Only requests that start in the range are used.
          </p>
        </div>
      )}

      {built !== null && "errors" in built && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {built.errors.join(" ")}
        </p>
      )}

      {built !== null && !("errors" in built) && (
        <Result built={built} apply={apply} undo={undo} onRun={onRun} />
      )}
    </div>
  );
}

type Built = Extract<ReturnType<typeof buildScenario>, { ok: true }> & { observed: ObservedSystem };

function Result({
  built,
  apply,
  undo,
  onRun,
}: {
  built: Built;
  apply: (p: string, o: PatchOp[]) => void;
  undo: (p: string) => void;
  onRun: (s: Scenario) => void;
}) {
  const { report, scenario, observed } = built;
  const c = report.counts;
  const mine = report.entries.filter((e) => e.origin === "user");
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <b>{report.entries.length} parameters:</b> {c.observed} measured, {c.inferred} inferred,{" "}
        {c.config} from configuration, {c.user} yours,{" "}
        <span className={c.assumed > 0 ? "font-semibold text-warn" : ""}>
          {c.assumed} placeholders
        </span>
        .
      </p>
      {report.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {report.questions.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Open questions ({report.questions.length}): what the traces cannot tell
          </h3>
          <ul className="grid gap-2 lg:grid-cols-2">
            {report.questions.map((q) => (
              <AnswerForm
                key={`${q.path}-${JSON.stringify(valueAt(scenario, q.path))}`}
                question={q}
                current={valueAt(scenario, q.path)}
                onApply={apply}
              />
            ))}
          </ul>
        </section>
      )}
      {mine.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Your answers ({mine.length})
          </h3>
          <ul className="space-y-1 text-xs">
            {mine.map((e) => (
              <li key={e.path} className="flex items-center gap-2 font-mono">
                <span className="text-muted-foreground">{e.path}</span>
                <span>{e.value === null ? "none" : JSON.stringify(e.value)}</span>
                <button
                  type="button"
                  onClick={() => undo(e.path)}
                  className="ml-auto inline-flex items-center gap-1 text-dim hover:text-foreground"
                  aria-label={`Undo ${e.path}`}
                >
                  <Undo2 className="size-3" aria-hidden /> undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onRun(scenario)}>
          <Play aria-hidden /> Run this scenario
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            downloadText(
              `${safeName(observed.name, "import")}-report.md`,
              renderReport(report),
              "text/markdown",
            )
          }
        >
          <Download aria-hidden /> Report (.md)
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            downloadText(
              `${safeName(observed.name, "import")}-observed.json`,
              `${JSON.stringify(observed, null, 2)}\n`,
            )
          }
        >
          <Download aria-hidden /> Observed system (.json)
        </Button>
      </div>
    </div>
  );
}
