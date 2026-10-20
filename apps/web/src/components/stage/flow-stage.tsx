"use client";

import type { FaultSpec, Scenario, SimulationResult } from "@fragor/engine";
import { useMemo } from "react";
import { describeEffect } from "@/lib/events";
import { linkFlow, sourceId } from "@/lib/flow";
import { bucketAt, type Playback, usePlayback } from "@/lib/playback";
import { stageLayout } from "@/lib/stage-layout";
import { ParticleCanvas } from "./particle-canvas";
import { StageLink } from "./stage-link";
import { StageNode, StageSource } from "./stage-node";

interface Props {
  scenario: Scenario;
  result: SimulationResult;
  playback: Playback;
  /** Node or edge id to outline (from a finding or an event). */
  highlight: string | null;
}

/** Label of every fault active at time `t`, keyed by the node, edge or traffic id it targets. */
function activeFaults(faults: readonly FaultSpec[], t: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of faults) {
    if (t < f.startMs || t >= f.startMs + f.durationMs) continue;
    const id =
      "node" in f.target ? f.target.node : "edge" in f.target ? f.target.edge : f.target.traffic;
    out.set(id, `fault: ${describeEffect(f)}`);
  }
  return out;
}

/** The architecture in motion: cards, links and particles for the current replay time. */
export function FlowStage({ scenario, result, playback, highlight }: Props) {
  const layout = useMemo(() => stageLayout(scenario), [scenario]);
  const { bucketMs, buckets } = result.series;
  const bucket = usePlayback(playback, (p) => bucketAt(p.timeMs, bucketMs, buckets));
  const faults = activeFaults(scenario.faults, bucket * bucketMs);
  const sources = [...new Set(scenario.traffic.map((t) => t.target))];

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Animated request flow between services"
      >
        {layout.links.map((g) => (
          <StageLink
            key={g.link.id}
            geometry={g}
            flow={linkFlow(result, g.link, bucket)}
            fault={g.link.kind === "edge" ? (faults.get(g.link.id) ?? null) : null}
            highlighted={highlight === g.link.id}
          />
        ))}
        {sources.map((target) => {
          const box = layout.boxes[sourceId(target)];
          if (box === undefined) return null;
          const traffic = scenario.traffic.filter((t) => t.target === target);
          const fault = traffic.map((t) => faults.get(t.id)).find((f) => f !== undefined) ?? null;
          return (
            <StageSource
              key={target}
              box={box}
              label="Users"
              detail={traffic.length === 1 ? null : `${traffic.length} traffic sources`}
              rps={((result.series.nodes[target]?.arrivals[bucket] ?? 0) * 1000) / bucketMs}
              fault={fault}
            />
          );
        })}
        {scenario.nodes.map((n) => {
          const box = layout.boxes[n.id];
          if (box === undefined) return null;
          return (
            <StageNode
              key={n.id}
              spec={n}
              box={box}
              result={result}
              bucket={bucket}
              fault={faults.get(n.id) ?? null}
              highlighted={highlight === n.id}
            />
          );
        })}
      </svg>
      <ParticleCanvas layout={layout} result={result} playback={playback} />
    </div>
  );
}
