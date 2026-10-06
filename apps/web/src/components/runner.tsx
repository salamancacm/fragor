"use client";

import { compareResults, type Scenario } from "@fragor/engine";
import { applyPatch, type Evidence, type PatchOp } from "@fragor/scenarios";
import { Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { EXAMPLES } from "@/lib/examples";
import { seconds } from "@/lib/format";
import { type Params, paramsOf, patchFor } from "@/lib/params";
import { useSimulation } from "@/lib/use-simulation";
import { ArchitectureGraph } from "./architecture-graph";
import { Charts } from "./charts";
import { ComparisonTable } from "./comparison-table";
import { HonestyBanner } from "./honesty-banner";
import { Insights } from "./insights";
import { ParamsPanel } from "./params-panel";
import { SummaryCards } from "./summary-cards";

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

export function Runner() {
  const { state, run, cancel } = useSimulation();
  const [file, setFile] = useState(FIRST?.file ?? "");
  const example = EXAMPLES.find((e) => e.file === file) ?? FIRST;
  const base = example?.scenario ?? null;
  const [params, setParams] = useState<Params | null>(base === null ? null : paramsOf(base));
  const [bucket, setBucket] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);

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

  // Run the first example once so the page opens with results.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (FIRST !== undefined) run(FIRST.scenario, FIRST.title.split(" · ")[0] ?? FIRST.file);
  }, []);

  const current = state.current;
  const shown = current !== null && current.scenario.name === scenario?.name ? current : current;
  const comparison = useMemo(
    () =>
      current !== null && state.previous !== null
        ? compareResults(state.previous.result, current.result)
        : null,
    [current, state.previous],
  );
  const buckets = current?.result.series.buckets ?? 1;
  const bucketMs = current?.result.series.bucketMs ?? 1000;
  const safeBucket = Math.min(bucket, buckets - 1);

  const onEvidence = (e: Evidence) => {
    setBucket(Math.floor(e.fromMs / bucketMs));
    setHighlight("nodeId" in e ? e.nodeId : "edgeId" in e ? e.edgeId : null);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fragor</h1>
          <p className="text-sm text-muted-foreground">
            Break your architecture before production does.
          </p>
        </div>
        <HonestyBanner />
      </header>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Scenario</CardTitle>
              <CardDescription>{example?.scenario.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="scenario">Example</Label>
                <Select
                  value={file}
                  onValueChange={(f) => {
                    const next = EXAMPLES.find((e) => e.file === f);
                    setFile(f);
                    setParams(next === undefined ? null : paramsOf(next.scenario));
                    setHighlight(null);
                  }}
                >
                  <SelectTrigger id="scenario" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXAMPLES.map((e) => (
                      <SelectItem key={e.file} value={e.file}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                {state.running === null ? (
                  <Button onClick={start} disabled={scenario === null} className="flex-1">
                    <Play aria-hidden /> Run
                  </Button>
                ) : (
                  <Button onClick={cancel} variant="secondary" className="flex-1">
                    <Square aria-hidden /> Stop
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => base !== null && setParams(paramsOf(base))}
                  disabled={ops.length === 0}
                  title="Reset parameters"
                >
                  <RotateCcw aria-hidden /> Reset
                </Button>
              </div>
              {state.running !== null && (
                <div className="space-y-1">
                  <Progress value={Math.round(state.running.progress * 100)} />
                  <p className="text-xs text-muted-foreground">
                    Simulating {state.running.label}… {Math.round(state.running.progress * 100)}%
                  </p>
                </div>
              )}
              {patchError !== null && (
                <p className="whitespace-pre-wrap text-xs text-red-700">{patchError}</p>
              )}
              {state.error !== null && (
                <p className="text-xs text-red-700">Simulation error: {state.error}</p>
              )}
            </CardContent>
          </Card>
          {scenario !== null && params !== null && base !== null && (
            <Card>
              <CardHeader>
                <CardTitle>Parameters</CardTitle>
                <CardDescription>Change, run again, compare with the previous run.</CardDescription>
              </CardHeader>
              <CardContent>
                <ParamsPanel scenario={base} params={params} ops={ops} onChange={setParams} />
              </CardContent>
            </Card>
          )}
        </aside>

        <main className="min-w-0 space-y-4">
          {shown === null ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Running the first simulation…
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-medium">
                  Run: {shown.label}
                  {state.previous !== null && (
                    <span className="text-muted-foreground">
                      {" "}
                      · compared with {state.previous.label}
                    </span>
                  )}
                </h2>
                <span className="font-mono text-[11px] text-muted-foreground">
                  fingerprint {shown.result.fingerprint}
                </span>
              </div>
              <SummaryCards summary={shown.result.summary} comparison={comparison} />

              <Card>
                <CardHeader>
                  <CardTitle>Architecture at t = {seconds(safeBucket * bucketMs)}</CardTitle>
                  <CardDescription>
                    Colored by health in the selected second: workers busy (⚙), failed responses
                    (✗), queue (≡), breaker state on edges.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ArchitectureGraph
                    scenario={shown.scenario}
                    result={shown.result}
                    bucket={safeBucket}
                    live={null}
                    highlight={highlight}
                  />
                  <Slider
                    min={0}
                    max={Math.max(0, buckets - 1)}
                    step={1}
                    value={[safeBucket]}
                    onValueChange={([b]) => setBucket(b ?? 0)}
                    aria-label="Time"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-2">
                  <Charts
                    scenario={shown.scenario}
                    current={shown.result}
                    previous={state.previous?.result ?? null}
                    cursorS={(safeBucket * bucketMs) / 1000}
                  />
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Insights</CardTitle>
                    <CardDescription>
                      Deterministic, rule-based findings computed from this run. Click evidence to
                      jump there.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Insights findings={shown.findings} onEvidence={onEvidence} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Before / after</CardTitle>
                    <CardDescription>
                      {comparison === null
                        ? "Change a parameter or pick another scenario and run again to compare."
                        : "Previous run vs this run."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {comparison !== null && state.previous !== null && (
                      <ComparisonTable
                        comparison={comparison}
                        labels={[state.previous.label, shown.label]}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="border-t pt-3 text-xs text-muted-foreground">
        The simulation runs entirely in your browser; nothing is sent anywhere. Results depend on
        the parameters you assume: use them to understand mechanisms, not to predict exact numbers.
      </footer>
    </div>
  );
}
