"use client";

import type { LiveSnapshot, Scenario, SimulationResult } from "@fragor/engine";
import {
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { pct } from "@/lib/format";
import { layoutGraph } from "@/lib/graph-layout";
import { edgeHealth, type Health, nodeHealth } from "@/lib/health";
import { EDGE_COLORS, HEALTH_LABEL, NODE_CLASSES } from "./health-style";

interface ServiceData extends Record<string, unknown> {
  name: string;
  kind: string;
  workers: number;
  health: Health;
  utilization: number | null;
  failRatio: number | null;
  queueDepth: number | null;
  highlighted: boolean;
}

type ServiceNode = Node<ServiceData, "service">;

function ServiceCard({ data }: NodeProps<ServiceNode>) {
  return (
    <div
      className={`w-40 rounded-lg border-2 px-3 py-2 text-xs shadow-sm ${NODE_CLASSES[data.health]} ${data.highlighted ? "ring-4 ring-blue-400" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold text-foreground">{data.name}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide">
          {HEALTH_LABEL[data.health]}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-1 whitespace-nowrap tabular-nums text-foreground/80">
        <span title="Worker utilization">⚙ {pct(data.utilization, 0)}</span>
        <span title="Failed responses">✗ {pct(data.failRatio, 0)}</span>
        <span title="Average queue depth">
          ≡ {data.queueDepth === null ? "–" : Math.round(data.queueDepth)}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {data.kind} · {data.workers} workers
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

const NODE_TYPES = { service: ServiceCard };

interface Props {
  scenario: Scenario;
  /** Result of this scenario, or null while it has not run yet. */
  result: SimulationResult | null;
  bucket: number;
  /** Live state while a run is in progress (shown when there is no result). */
  live: LiveSnapshot | null;
  highlight: string | null;
}

function liveHealth(utilization: number): Health {
  if (utilization >= 0.95) return "critical";
  if (utilization >= 0.8) return "stressed";
  return utilization > 0 ? "healthy" : "idle";
}

/** The architecture, colored by health at the selected time bucket. */
export function ArchitectureGraph({ scenario, result, bucket, live, highlight }: Props) {
  const positions = useMemo(() => layoutGraph(scenario), [scenario]);

  const nodes: ServiceNode[] = scenario.nodes.map((n) => {
    let state = {
      health: "idle" as Health,
      utilization: null as number | null,
      failRatio: null as number | null,
      queueDepth: null as number | null,
    };
    if (result !== null) {
      state = nodeHealth(result, n.id, bucket);
    } else if (live !== null) {
      const s = live.nodes[n.id];
      const util =
        s === undefined || s.effectiveWorkers === 0 ? 0 : s.busyWorkers / s.effectiveWorkers;
      state = {
        health: liveHealth(util),
        utilization: util,
        failRatio: null,
        queueDepth: s?.queueDepth ?? null,
      };
    }
    return {
      id: n.id,
      type: "service",
      position: positions[n.id] ?? { x: 0, y: 0 },
      draggable: false,
      data: {
        name: n.name,
        kind: n.kind,
        workers: n.workers,
        ...state,
        highlighted: highlight === n.id,
      },
    };
  });

  const edges: Edge[] = scenario.edges.map((e) => {
    const h = result === null ? null : edgeHealth(result, e.id, bucket);
    const color = EDGE_COLORS[h?.health ?? "idle"];
    const label = [
      h?.breaker !== null && h?.breaker !== undefined ? `breaker ${h.breaker}` : null,
      h?.failRatio ? `${pct(h.failRatio, 0)} failed` : null,
    ]
      .filter((x) => x !== null)
      .join(" · ");
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      animated: (h?.arrivals ?? 0) > 0,
      label: label === "" ? undefined : label,
      labelStyle: { fontSize: 10 },
      style: { stroke: color, strokeWidth: highlight === e.id ? 4 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    } satisfies Edge;
  });

  return (
    <section
      className="h-80 w-full rounded-md border bg-background"
      aria-label="Architecture graph"
    >
      <ReactFlow
        key={scenario.name}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: false }}
      />
    </section>
  );
}
