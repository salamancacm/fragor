import type { NodeSpec, SimulationResult } from "@fragor/engine";
import { type NodeStatus, nodeStatus } from "@/lib/node-status";
import type { Box } from "@/lib/stage-layout";

const STATUS_COLOR: Record<NodeStatus, string> = {
  idle: "var(--dim)",
  healthy: "var(--ok)",
  busy: "var(--warn)",
  saturated: "var(--bad)",
  overloaded: "var(--bad)",
};

const fillColor = (r: number) =>
  r >= 0.95 ? "var(--bad)" : r >= 0.6 ? "var(--warn)" : "var(--ok)";

interface Props {
  spec: NodeSpec;
  box: Box;
  result: SimulationResult;
  bucket: number;
  fault: string | null;
  highlighted: boolean;
}

/** A service card: worker and queue gauges, 503 shedding, status and the active fault. */
export function StageNode({ spec, box, result, bucket, fault, highlighted }: Props) {
  const s = result.series.nodes[spec.id];
  const u = s?.utilization?.[bucket] ?? 0;
  const q = s?.queueDepthAvg?.[bucket] ?? 0;
  const shed = s?.rejected503[bucket] ?? 0;
  const queueFill =
    spec.queueLimit === null || spec.queueLimit === 0 ? 0 : Math.min(1, q / spec.queueLimit);
  const status = nodeStatus(u, queueFill, (s?.arrivals[bucket] ?? 0) > 0 || u > 0);
  const hot = status === "saturated" || status === "overloaded";
  const { x, y, w, h } = box;
  const gaugeW = w - 28;
  const gauge = (label: string, value: string, ratio: number, top: number) => (
    <g>
      <text x={x + 14} y={top} fontSize={13} fill="var(--muted-foreground)">
        {label}
      </text>
      <text
        x={x + w - 14}
        y={top}
        fontSize={13}
        textAnchor="end"
        fill="var(--muted-foreground)"
        className="font-mono"
      >
        {value}
      </text>
      <rect x={x + 14} y={top + 8} width={gaugeW} height={9} rx={4.5} fill="var(--border)" />
      <rect
        x={x + 14}
        y={top + 8}
        width={Math.max(0, Math.min(1, ratio)) * gaugeW}
        height={9}
        rx={4.5}
        fill={fillColor(ratio)}
        style={{ transition: "width 250ms linear, fill 250ms" }}
      />
    </g>
  );

  return (
    <g aria-label={`${spec.name}: ${status}`}>
      {hot && (
        <rect
          x={x - 5}
          y={y - 5}
          width={w + 10}
          height={h + 10}
          rx={19}
          fill="none"
          stroke="var(--bad)"
          strokeWidth={2}
          className="fragor-pulse"
        />
      )}
      {highlighted && (
        <rect
          x={x - 9}
          y={y - 9}
          width={w + 18}
          height={h + 18}
          rx={22}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={2}
          strokeDasharray="6 5"
        />
      )}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={14}
        fill="var(--panel)"
        stroke={hot ? "var(--bad)" : "var(--line)"}
        strokeWidth={1.5}
      />
      <text x={x + 14} y={y + 26} fontSize={17} fontWeight={600} fill="var(--foreground)">
        {spec.name}
      </text>
      <text x={x + 14} y={y + 46} fontSize={13} fill="var(--dim)">
        {spec.kind === "external-api" ? "external API" : `${spec.workers} workers`}
      </text>
      <text
        x={x + w - 14}
        y={y + 46}
        fontSize={12}
        fontWeight={700}
        textAnchor="end"
        letterSpacing="0.06em"
        fill={STATUS_COLOR[status]}
        className="font-mono"
      >
        {status.toUpperCase()}
      </text>
      {gauge("Workers busy", `${Math.round(u * spec.workers)}/${spec.workers}`, u, y + 80)}
      {gauge(
        "Queue",
        spec.queueLimit === null ? `${Math.round(q)}` : `${Math.round(q)}/${spec.queueLimit}`,
        queueFill,
        y + 120,
      )}
      {shed > 0 && (
        <text x={x + 14} y={y + h - 14} fontSize={13} fill="var(--bad)" className="font-mono">
          ▼ {shed}/s rejected (503)
        </text>
      )}
      {fault !== null && (
        <g>
          <rect
            x={x + 8}
            y={y - 36}
            width={w - 16}
            height={26}
            rx={13}
            fill="color-mix(in srgb, var(--warn) 14%, transparent)"
            stroke="var(--warn)"
          />
          <text
            x={x + w / 2}
            y={y - 18}
            fontSize={12}
            fontWeight={600}
            textAnchor="middle"
            fill="var(--warn)"
          >
            {fault}
          </text>
          <rect
            x={x - 5}
            y={y - 5}
            width={w + 10}
            height={h + 10}
            rx={19}
            fill="none"
            stroke="var(--warn)"
            strokeWidth={2}
            className="fragor-pulse"
          />
        </g>
      )}
    </g>
  );
}

interface SourceProps {
  box: Box;
  label: string;
  /** Extra line, e.g. how many traffic sources feed this entry node. */
  detail: string | null;
  rps: number;
  fault: string | null;
}

/** Where traffic comes from: request rate into the entry node. */
export function StageSource({ box, label, detail, rps, fault }: SourceProps) {
  const { x, y, w, h } = box;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill="var(--muted)" stroke="var(--line)" />
      <text
        x={x + w / 2}
        y={y + 40}
        fontSize={16}
        fontWeight={600}
        textAnchor="middle"
        fill="var(--foreground)"
      >
        {label}
      </text>
      <text
        x={x + w / 2}
        y={y + 64}
        fontSize={14}
        textAnchor="middle"
        fill="var(--muted-foreground)"
        className="font-mono"
      >
        {Math.round(rps)} req/s
      </text>
      {detail !== null && (
        <text x={x + w / 2} y={y + 84} fontSize={11} textAnchor="middle" fill="var(--dim)">
          {detail}
        </text>
      )}
      {fault !== null && (
        <text
          x={x + w / 2}
          y={y - 12}
          fontSize={12}
          fontWeight={600}
          textAnchor="middle"
          fill="var(--warn)"
        >
          {fault}
        </text>
      )}
    </g>
  );
}
