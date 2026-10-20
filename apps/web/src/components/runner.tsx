"use client";

import { compareResults, type Scenario, type SimulationResult } from "@fragor/engine";
import { applyPatch, type Evidence, type PatchOp } from "@fragor/scenarios";
import { useEffect, useMemo, useState } from "react";
import { deriveEvents } from "@/lib/events";
import { EXAMPLES } from "@/lib/examples";
import { type Params, paramsOf, patchFor } from "@/lib/params";
import { bucketAt, Playback, usePlayback } from "@/lib/playback";
import { storyOf } from "@/lib/story";
import { useSimulation } from "@/lib/use-simulation";
import { Charts } from "./charts";
import { ComparisonTable } from "./comparison-table";
import { EventFeed } from "./event-feed";
import { Insights } from "./insights";
import { KpiStrip } from "./kpi-strip";
import { ParamsPanel } from "./params-panel";
import { FlowStage } from "./stage/flow-stage";
import { StoryHeadline } from "./story-headline";
import { TopBar } from "./top-bar";
import { Transport } from "./transport";

const FIRST = EXAMPLES[0];

function patched(
  base: Scenario,
  ops: PatchOp[],
): { scenario: Scenario | null; error: string | null } {
  try {
    return { scenario: applyPatch(base, ops), error: null };
  } catch (e) {
    return { scenario: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const LEGEND = [
  ["var(--ok)", "request / success"],
  ["var(--deg)", "fallback"],
  ["var(--bad)", "failed / rejected"],
] as const;

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border bg-card p-4 ${className}`}>
      <h2 className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Charts follow the replay cursor; only this wrapper re-renders as the replay advances. */
function ChartsAtCursor({
  scenario,
  result,
  previous,
  playback,
}: {
  scenario: Scenario;
  result: SimulationResult;
  previous: SimulationResult | null;
  playback: Playback;
}) {
  const { bucketMs, buckets } = result.series;
  const bucket = usePlayback(playback, (p) => bucketAt(p.timeMs, bucketMs, buckets));
  return (
    <Charts
      scenario={scenario}
      current={result}
      previous={previous}
      cursorS={(bucket * bucketMs) / 1000}
    />
  );
}

export function Runner() {
  const { state, run, cancel } = useSimulation();
  const [file, setFile] = useState(FIRST?.file ?? "");
  const example = EXAMPLES.find((e) => e.file === file) ?? FIRST;
  const base = example?.scenario ?? null;
  const [params, setParams] = useState<Params | null>(base === null ? null : paramsOf(base));
  const [highlight, setHighlight] = useState<string | null>(null);
  const [playback] = useState(() => new Playback());

  const ops = useMemo(
    () => (base === null || params === null ? [] : patchFor(base, params)),
    [base, params],
  );
  const { scenario, error: patchError } = useMemo(
    () => (base === null ? { scenario: null, error: "no scenario" } : patched(base, ops)),
    [base, ops],
  );
  const label = `${example?.title.split(" · ")[0] ?? ""}${ops.length > 0 ? ` + ${ops.length} change(s)` : ""}`;
  const start = () => {
    if (scenario !== null) run(scenario, label);
  };

  // Run the first example once so the page opens with a replay.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (FIRST !== undefined) run(FIRST.scenario, FIRST.title.split(" · ")[0] ?? FIRST.file);
  }, []);

  const current = state.current;
  // Every finished run replays from the start.
  useEffect(() => {
    if (current !== null)
      playback.load(current.result.series.buckets * current.result.series.bucketMs);
  }, [current, playback]);

  const events = useMemo(
    () => (current === null ? [] : deriveEvents(current.scenario, current.result)),
    [current],
  );
  const story = useMemo(
    () => (current === null ? [] : storyOf(current.scenario, current.result, current.findings)),
    [current],
  );
  const comparison = useMemo(
    () =>
      current !== null && state.previous !== null
        ? compareResults(state.previous.result, current.result)
        : null,
    [current, state.previous],
  );

  const jump = (tMs: number, ref: string | null) => {
    playback.seek(tMs);
    setHighlight(ref);
  };
  const onEvidence = (e: Evidence) =>
    jump(e.fromMs, "nodeId" in e ? e.nodeId : "edgeId" in e ? e.edgeId : null);

  return (
    <div className="mx-auto max-w-[1560px] px-4 pb-12 sm:px-6">
      <TopBar
        file={file}
        onFile={(f) => {
          const next = EXAMPLES.find((e) => e.file === f);
          setFile(f);
          setParams(next === undefined ? null : paramsOf(next.scenario));
          setHighlight(null);
          if (next !== undefined) run(next.scenario, next.title.split(" · ")[0] ?? next.file);
        }}
        running={state.running}
        canRun={scenario !== null}
        changes={ops.length}
        onRun={start}
        onStop={cancel}
        onReset={() => base !== null && setParams(paramsOf(base))}
        fingerprint={current?.result.fingerprint ?? null}
      />
      {patchError !== null && (
        <p className="mt-3 text-sm whitespace-pre-wrap text-bad">{patchError}</p>
      )}
      {state.error !== null && (
        <p className="mt-3 text-sm text-bad">Simulation error: {state.error}</p>
      )}

      {current === null ? (
        <p className="py-24 text-center text-muted-foreground">Running the first simulation…</p>
      ) : (
        <>
          <div className="py-7">
            <StoryHeadline parts={story} />
            <p className="mt-2 text-sm text-dim">
              Run: {current.label}
              {state.previous !== null && ` · compared with ${state.previous.label}`}
            </p>
          </div>
          <KpiStrip
            result={current.result}
            previous={state.previous?.result ?? null}
            comparison={comparison}
            playback={playback}
          />

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
            <section className="min-w-0 rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  Request flow
                </h2>
                <div className="ml-auto flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {LEGEND.map(([c, l]) => (
                    <span key={l} className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: c }} />
                      {l}
                    </span>
                  ))}
                </div>
              </div>
              <FlowStage
                scenario={current.scenario}
                result={current.result}
                playback={playback}
                highlight={highlight}
              />
              <Transport
                scenario={current.scenario}
                result={current.result}
                events={events}
                playback={playback}
              />
            </section>
            <aside className="relative min-h-80 rounded-2xl border bg-card pt-4">
              <h2 className="px-4 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                What's happening
              </h2>
              <EventFeed events={events} playback={playback} onSelect={(e) => jump(e.tMs, e.ref)} />
            </aside>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_400px]">
            <Panel title="Findings">
              <Insights findings={current.findings} onEvidence={onEvidence} />
            </Panel>
            {scenario !== null && params !== null && base !== null && (
              <Panel title="What if…">
                <p className="mb-4 text-sm text-muted-foreground">
                  {example?.scenario.description}
                </p>
                <ParamsPanel scenario={base} params={params} ops={ops} onChange={setParams} />
              </Panel>
            )}
          </div>

          <Panel title="Over time" className="mt-4">
            <ChartsAtCursor
              scenario={current.scenario}
              result={current.result}
              previous={state.previous?.result ?? null}
              playback={playback}
            />
          </Panel>

          {comparison !== null && state.previous !== null && (
            <Panel
              title={`Before / after: ${state.previous.label} → ${current.label}`}
              className="mt-4"
            >
              <ComparisonTable
                comparison={comparison}
                labels={[state.previous.label, current.label]}
              />
            </Panel>
          )}
        </>
      )}

      <footer className="mt-8 border-t pt-3 text-xs text-dim">
        The simulation runs entirely in your browser; nothing is sent anywhere. Results depend on
        the parameters you assume: use them to understand mechanisms, not to predict exact numbers.
      </footer>
    </div>
  );
}
