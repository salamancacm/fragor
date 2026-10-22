"use client";

import type { Scenario } from "@fragor/engine";
import type { PatchOp } from "@fragor/scenarios";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { describeOp, type EdgeParams, type Params } from "@/lib/params";
import { HelpTip } from "./guide/help-tip";

interface Props {
  scenario: Scenario;
  params: Params;
  ops: readonly PatchOp[];
  onChange: (next: Params) => void;
}

const FACTORS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Knobs of the what-if. Every change becomes a typed patch, validated before it runs. */
export function ParamsPanel({ scenario, params, ops, onChange }: Props) {
  const factorIndex = Math.max(0, FACTORS.indexOf(params.trafficFactor));
  const setEdge = (id: string, patch: Partial<EdgeParams>) => {
    const current = params.edges[id];
    if (current === undefined) return;
    onChange({ ...params, edges: { ...params.edges, [id]: { ...current, ...patch } } });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="traffic-factor">Traffic</Label>
          <span className="text-sm tabular-nums">× {params.trafficFactor}</span>
        </div>
        <Slider
          id="traffic-factor"
          min={0}
          max={FACTORS.length - 1}
          step={1}
          value={[factorIndex]}
          onValueChange={([i]) => onChange({ ...params, trafficFactor: FACTORS[i ?? 3] ?? 1 })}
          aria-label="Traffic multiplier"
        />
      </div>

      {scenario.edges.map((edge) => {
        const p = params.edges[edge.id];
        if (p === undefined) return null;
        return (
          <fieldset key={edge.id} className="space-y-2 rounded-md border p-3">
            <legend className="px-1 font-mono text-xs">
              {edge.from} → {edge.to}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor={`timeout-${edge.id}`} className="text-xs">
                    Timeout (ms)
                  </Label>
                  <HelpTip topic="timeout" label="a timeout" />
                </div>
                <Input
                  id={`timeout-${edge.id}`}
                  type="number"
                  min={1}
                  placeholder="default 30000"
                  value={p.timeoutMs ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    setEdge(edge.id, { timeoutMs: v !== null && v > 0 ? v : null });
                  }}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor={`retries-${edge.id}`} className="text-xs">
                    Retries
                  </Label>
                  <HelpTip topic="retry" label="a retry" />
                </div>
                <Input
                  id={`retries-${edge.id}`}
                  type="number"
                  min={0}
                  max={10}
                  value={p.retries}
                  onChange={(e) =>
                    setEdge(edge.id, {
                      retries: Math.max(0, Math.min(10, Math.trunc(Number(e.target.value) || 0))),
                    })
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor={`pool-${edge.id}`}
                className="text-xs"
                title="Synchronous @Timeout in Quarkus: the interruption runs on the caller's worker pool, so it is late or lost when that pool is saturated. Off = enforced on time (REST client read-timeout)."
              >
                Timeout runs on caller's pool
              </Label>
              <Switch
                id={`pool-${edge.id}`}
                checked={p.timeoutOnCallerPool}
                disabled={p.timeoutMs === null}
                onCheckedChange={(checked) => setEdge(edge.id, { timeoutOnCallerPool: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Label htmlFor={`breaker-${edge.id}`} className="text-xs">
                  Circuit breaker
                </Label>
                <HelpTip topic="breaker" label="a circuit breaker" />
              </div>
              <Switch
                id={`breaker-${edge.id}`}
                checked={p.breaker}
                onCheckedChange={(checked) => setEdge(edge.id, { breaker: checked })}
              />
            </div>
          </fieldset>
        );
      })}

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">What-if changes ({ops.length})</p>
        {ops.length === 0 ? (
          <p className="text-xs text-muted-foreground">None: running the scenario as written.</p>
        ) : (
          <ul className="space-y-0.5 font-mono text-[11px] leading-snug break-all">
            {ops.map((op) => (
              <li key={describeOp(op)}>{describeOp(op)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
