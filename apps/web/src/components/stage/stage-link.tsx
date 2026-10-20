import type { BreakerState } from "@fragor/engine";
import type { LinkFlow } from "@/lib/flow";
import { LANE, type LinkGeometry, labelAnchor, lanePath, pointOn } from "@/lib/stage-layout";

const BREAKER_COLOR: Record<BreakerState, string> = {
  closed: "var(--ok)",
  "half-open": "var(--warn)",
  open: "var(--bad)",
};
const BREAKER_ANGLE: Record<BreakerState, number> = { closed: 0, "half-open": 45, open: 90 };

interface Props {
  geometry: LinkGeometry;
  flow: LinkFlow;
  fault: string | null;
  highlighted: boolean;
}

/**
 * A link with its request lane (top, left to right) and response lane (bottom, back): policy
 * labels above, load amplification and rate below, the circuit breaker drawn as a gate.
 */
export function StageLink({ geometry: g, flow, fault, highlighted }: Props) {
  const mid = labelAnchor(g);
  const gate = { x: mid.x, y: mid.y - LANE };
  const { link } = g;
  const lane = highlighted ? "var(--brand)" : "var(--line)";
  const end = pointOn(g, 1, -LANE);
  const start = pointOn(g, 0, LANE);
  const amp = flow.amplification;
  const breaker = flow.breaker;
  return (
    <g>
      <path
        d={lanePath(g, -LANE)}
        fill="none"
        stroke={lane}
        strokeWidth={2}
        strokeDasharray="2 6"
      />
      <path d={lanePath(g, LANE)} fill="none" stroke={lane} strokeWidth={2} strokeDasharray="2 6" />
      <path
        d={`M${end.x - 8},${end.y - 5} L${end.x},${end.y} L${end.x - 8},${end.y + 5}`}
        fill="none"
        stroke="var(--dim)"
        strokeWidth={1.5}
      />
      <path
        d={`M${start.x + 8},${start.y - 5} L${start.x},${start.y} L${start.x + 8},${start.y + 5}`}
        fill="none"
        stroke="var(--dim)"
        strokeWidth={1.5}
      />
      {link.policies.map((label, i) => {
        const isBreaker = label === "breaker" && breaker !== null;
        return (
          <text
            key={label}
            x={mid.x}
            y={mid.y - 30 - (link.policies.length - 1 - i) * 15}
            fontSize={12}
            textAnchor="middle"
            fontWeight={isBreaker ? 700 : 400}
            fill={isBreaker ? BREAKER_COLOR[breaker] : "var(--muted-foreground)"}
            className="font-mono"
          >
            {isBreaker ? `breaker ${breaker}` : label}
          </text>
        );
      })}
      {link.hasBreaker && breaker !== null && (
        <g transform={`translate(${gate.x},${gate.y})`} aria-label={`circuit breaker ${breaker}`}>
          <circle r={11} fill="var(--card)" stroke={BREAKER_COLOR[breaker]} strokeWidth={2} />
          <line
            x1={-6}
            x2={6}
            stroke={BREAKER_COLOR[breaker]}
            strokeWidth={2.5}
            strokeLinecap="round"
            transform={`rotate(${BREAKER_ANGLE[breaker]})`}
            style={{ transition: "transform 300ms" }}
          />
        </g>
      )}
      {amp !== null && amp >= 1.3 && (
        <text
          x={mid.x}
          y={mid.y + 46}
          fontSize={14}
          fontWeight={700}
          textAnchor="middle"
          fill="var(--warn)"
          className="font-mono"
        >
          ×{amp.toFixed(1)} load
        </text>
      )}
      {link.kind === "edge" && (
        <text
          x={mid.x}
          y={mid.y + 64}
          fontSize={12}
          textAnchor="middle"
          fill="var(--dim)"
          className="font-mono"
        >
          {flow.sent}/s sent
        </text>
      )}
      {fault !== null && (
        <text
          x={mid.x}
          y={mid.y + 82}
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
