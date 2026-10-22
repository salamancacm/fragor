"use client";

import { compareResults, type Scenario, type SimulationResult } from "@fragor/engine";
import { applyPatch, type Evidence, type PatchOp } from "@fragor/scenarios";
import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { deriveEvents } from "@/lib/events";
import { EXAMPLES } from "@/lib/examples";
import { type HelpKey, TOUR, type TourStep, type TourTarget, troubleMoment } from "@/lib/guide";
import { type Params, paramsOf, patchFor } from "@/lib/params";
import { bucketAt, Playback, usePlayback } from "@/lib/playback";
import { storyOf } from "@/lib/story";
import { useSimulation } from "@/lib/use-simulation";
import { Charts } from "./charts";
import { ComparisonTable } from "./comparison-table";
import { CustomScenario, downloadScenario } from "./custom/custom-scenario";
import { EventFeed } from "./event-feed";
import { HelpTip } from "./guide/help-tip";
import { Tour } from "./guide/tour";
import { useGuide } from "./guide/use-guide";
import { Welcome } from "./guide/welcome";
import { Insights } from "./insights";
import { KpiStrip } from "./kpi-strip";
import { ParamsPanel } from "./params-panel";
import { FlowStage } from "./stage/flow-stage";
import { StoryHeadline } from "./story-headline";
import { TopBar } from "./top-bar";
import { Transport } from "./transport";

const FIRST = EXAMPLES[0];
/** Value of the scenario picker for the user's own scenario. */
const CUSTOM = "custom";

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

function SectionTitle({ title, help }: { title: string; help?: HelpKey }) {
  return (
    <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {title}
      {help !== undefined && <HelpTip topic={help} label={title} />}
    </h2>
  );
}

function Panel({
  title,
  help,
  tour,
  children,
  className = "",
}: {
  title: string;
  help?: HelpKey;
  tour?: TourTarget;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border bg-card p-4 ${className}`} data-tour={tour}>
      <div className="mb-2">
        <SectionTitle title={title} {...(help === undefined ? {} : { help })} />
      </div>
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
  // The user's own scenario (quick form or JSON); selected with file === CUSTOM.
  const [custom, setCustom] = useState<Scenario | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const example = EXAMPLES.find((e) => e.file === file) ?? FIRST;
  const isCustom = file === CUSTOM && custom !== null;
  const base = isCustom ? custom : (example?.scenario ?? null);
  const baseLabel = isCustom ? `Yours: ${custom.name}` : (example?.title.split(" · ")[0] ?? "");
  const [params, setParams] = useState<Params | null>(base === null ? null : paramsOf(base));
  const [highlight, setHighlight] = useState<string | null>(null);
  const [playback] = useState(() => new Playback());
  const guide = useGuide();

  const ops = useMemo(
    () => (base === null || params === null ? [] : patchFor(base, params)),
    [base, params],
  );
  const { scenario, error: patchError } = useMemo(
    () => (base === null ? { scenario: null, error: "no scenario" } : patched(base, ops)),
    [base, ops],
  );
  const label = `${baseLabel}${ops.length > 0 ? ` + ${ops.length} change(s)` : ""}`;
  const runCustom = (s: Scenario) => {
    setCustom(s);
    setFile(CUSTOM);
    setParams(paramsOf(s));
    setHighlight(null);
    setShowCustom(false);
    run(s, `Yours: ${s.name}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
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
  const startTour = () => {
    // The tour is written for example 01: show it, from the start.
    setShowCustom(false);
    setHighlight(null);
    if (FIRST !== undefined && (file !== FIRST.file || ops.length > 0 || current === null)) {
      setFile(FIRST.file);
      setParams(paramsOf(FIRST.scenario));
      run(FIRST.scenario, FIRST.title.split(" · ")[0] ?? FIRST.file);
    }
    guide.tour();
  };
  const onTourStep = useCallback(
    (step: TourStep) => {
      if (step.replay === "start") playback.seek(0);
      else if (step.replay === "trouble") {
        // Slow down so the cascade can be watched while reading the step.
        playback.seek(troubleMoment(events));
        playback.setSpeed(1);
      }
      if (step.replay !== undefined) playback.play();
    },
    [playback, events],
  );
  const onEvidence = (e: Evidence) =>
    jump(e.fromMs, "nodeId" in e ? e.nodeId : "edgeId" in e ? e.edgeId : null);

  return (
    <div className="mx-auto max-w-[1560px] px-4 pb-12 sm:px-6">
      <TopBar
        file={file}
        onFile={(f) => {
          if (f === CUSTOM) {
            if (custom !== null) runCustom(custom);
            return;
          }
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
        customName={custom?.name ?? null}
        customOpen={showCustom}
        onCustom={() => setShowCustom((v) => !v)}
        onHelp={guide.welcome}
      />
      {guide.state === "welcome" && (
        <Welcome
          onTour={startTour}
          onOwn={() => {
            guide.close();
            setShowCustom(true);
          }}
          onSkip={guide.close}
        />
      )}
      {guide.state === "tour" && <Tour steps={TOUR} onStep={onTourStep} onClose={guide.close} />}
      {showCustom && (
        <CustomScenario current={scenario} onRun={runCustom} onClose={() => setShowCustom(false)} />
      )}
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
          <div className="py-7" data-tour="story">
            <StoryHeadline parts={story} />
            <p className="mt-2 text-sm text-dim">
              Run: {current.label}
              {state.previous !== null && ` · compared with ${state.previous.label}`}
            </p>
          </div>
          <div data-tour="kpis">
            <KpiStrip
              result={current.result}
              previous={state.previous?.result ?? null}
              comparison={comparison}
              playback={playback}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
            <section className="min-w-0 rounded-2xl border bg-card p-4" data-tour="stage">
              <div className="flex flex-wrap items-center gap-3">
                <SectionTitle title="Request flow" help="flow" />
                <HelpTip topic="card" label="a service card" />
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
              <div data-tour="transport">
                <Transport
                  scenario={current.scenario}
                  result={current.result}
                  events={events}
                  playback={playback}
                />
              </div>
            </section>
            <aside className="relative min-h-80 rounded-2xl border bg-card pt-4" data-tour="feed">
              <div className="px-4">
                <SectionTitle title="What's happening" help="feed" />
              </div>
              <EventFeed events={events} playback={playback} onSelect={(e) => jump(e.tMs, e.ref)} />
            </aside>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_400px]">
            <Panel title="Findings" help="findings" tour="findings">
              <Insights findings={current.findings} onEvidence={onEvidence} />
            </Panel>
            {scenario !== null && params !== null && base !== null && (
              <Panel title="What if…" help="whatIf" tour="what-if">
                <p className="mb-4 text-sm text-muted-foreground">{base.description}</p>
                <ParamsPanel scenario={base} params={params} ops={ops} onChange={setParams} />
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                  <Button variant="outline" size="sm" onClick={() => downloadScenario(scenario)}>
                    <Download aria-hidden /> Download this scenario (JSON)
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowCustom(true)}>
                    Edit it or model your own…
                  </Button>
                </div>
              </Panel>
            )}
          </div>

          <details className="group mt-4 rounded-2xl border bg-card">
            <summary className="cursor-pointer list-none p-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <span className="text-muted-foreground group-open:hidden">▸ </span>
              <span className="hidden text-muted-foreground group-open:inline">▾ </span>
              More detail: charts over time
              {comparison !== null && " and the before / after table"}
            </summary>
            <div className="space-y-6 px-4 pb-4">
              <ChartsAtCursor
                scenario={current.scenario}
                result={current.result}
                previous={state.previous?.result ?? null}
                playback={playback}
              />
              {comparison !== null && state.previous !== null && (
                <div>
                  <SectionTitle
                    title={`Before / after: ${state.previous.label} → ${current.label}`}
                  />
                  <ComparisonTable
                    comparison={comparison}
                    labels={[state.previous.label, current.label]}
                  />
                </div>
              )}
            </div>
          </details>
        </>
      )}

      <footer className="mt-8 border-t pt-3 text-xs text-dim">
        The simulation runs entirely in your browser; nothing is sent anywhere. Results depend on
        the parameters you assume: use them to understand mechanisms, not to predict exact numbers.
      </footer>
    </div>
  );
}
