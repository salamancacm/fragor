"use client";

import type { Scenario, SimulationResult } from "@fragor/engine";
import type { ReactNode } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { breakerRows, faultWindows, globalRows, nodeRows, type Row } from "@/lib/chart-data";

/** Distinct series colors for per-node and per-edge charts, readable on the dark ground. */
const SERIES_COLORS = ["#3fb6f2", "#b48cf2", "#f5a524", "#ff5a5f", "#4fd1a5", "#f78fb3", "#8a9ab0"];

interface Props {
  scenario: Scenario;
  current: SimulationResult;
  previous: SimulationResult | null;
  /** Selected time in seconds (time slider). */
  cursorS: number;
}

interface LineDef {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
}

function Chart({
  rows,
  lines,
  scenario,
  cursorS,
  yFormat,
  yDomain,
  step,
}: {
  rows: Row[];
  lines: LineDef[];
  scenario: Scenario;
  cursorS: number;
  yFormat: (v: number) => string;
  yDomain?: [number, number];
  step?: boolean;
}): ReactNode {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => `${v}s`}
            fontSize={11}
            stroke="var(--dim)"
          />
          <YAxis
            tickFormatter={yFormat}
            fontSize={11}
            stroke="var(--dim)"
            width={56}
            {...(yDomain === undefined ? {} : { domain: yDomain })}
          />
          <Tooltip
            formatter={(v) => (typeof v === "number" ? yFormat(v) : String(v))}
            labelFormatter={(t) => `t = ${String(t)} s`}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {faultWindows(scenario).map((f) => (
            <ReferenceArea
              key={f.id}
              x1={f.fromS}
              x2={f.toS}
              fill="var(--warn)"
              fillOpacity={0.1}
              label={{ value: f.id, fontSize: 10, position: "insideTop", fill: "var(--warn)" }}
            />
          ))}
          <ReferenceLine x={cursorS} stroke="var(--foreground)" strokeOpacity={0.6} />
          {lines.map((l) => (
            <Line
              key={l.key}
              dataKey={l.key}
              name={l.name}
              stroke={l.color}
              dot={false}
              strokeWidth={l.dashed === true ? 1.5 : 2}
              {...(l.dashed === true ? { strokeDasharray: "5 4" } : {})}
              type={step === true ? "stepAfter" : "linear"}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const num = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
const percent = (v: number) => `${(v * 100).toFixed(0)}%`;
const millis = (v: number) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`}`;
const BREAKER_LABELS = ["closed", "half-open", "open"];

/** Time series of the run; dashed lines are the previous run, red bands are injected faults. */
export function Charts({ scenario, current, previous, cursorS }: Props) {
  const global = globalRows(current, previous);
  const hasPrev = previous !== null;
  const prevLine = (key: string, name: string): LineDef[] =>
    hasPrev ? [{ key, name: `${name} (previous run)`, color: "var(--dim)", dashed: true }] : [];
  const nodeIds = scenario.nodes.map((n) => n.id);
  const perNode = (): LineDef[] =>
    nodeIds.map((id, i) => ({
      key: id,
      name: id,
      color: SERIES_COLORS[i % SERIES_COLORS.length] ?? "#000",
    }));
  const breakers = breakerRows(current);
  const common = { scenario, cursorS };

  return (
    <Tabs defaultValue="throughput" className="w-full">
      <TabsList className="flex-wrap">
        <TabsTrigger value="throughput">Throughput</TabsTrigger>
        <TabsTrigger value="latency">p95 latency</TabsTrigger>
        <TabsTrigger value="errors">Error rate</TabsTrigger>
        <TabsTrigger value="queue">Queue depth</TabsTrigger>
        <TabsTrigger value="utilization">Utilization</TabsTrigger>
        <TabsTrigger value="breaker">Breaker</TabsTrigger>
      </TabsList>
      <TabsContent value="throughput">
        <Chart
          {...common}
          rows={global}
          yFormat={num}
          lines={[
            { key: "rps", name: "arrivals/s", color: "var(--muted-foreground)" },
            { key: "successRps", name: "success/s", color: "var(--ok)" },
            { key: "degradedRps", name: "fallback/s", color: "var(--deg)" },
            { key: "failedRps", name: "failed/s", color: "var(--bad)" },
            ...prevLine("prevRps", "arrivals/s"),
          ]}
        />
      </TabsContent>
      <TabsContent value="latency">
        <Chart
          {...common}
          rows={global}
          yFormat={millis}
          lines={[
            { key: "p95", name: "p95 end-to-end", color: "var(--warn)" },
            ...prevLine("prevP95", "p95"),
          ]}
        />
      </TabsContent>
      <TabsContent value="errors">
        <Chart
          {...common}
          rows={global}
          yFormat={percent}
          yDomain={[0, 1]}
          lines={[
            { key: "errorRate", name: "failed / completed", color: "var(--bad)" },
            ...prevLine("prevErrorRate", "failed / completed"),
          ]}
        />
      </TabsContent>
      <TabsContent value="queue">
        <Chart
          {...common}
          rows={nodeRows(current, "queueDepthAvg")}
          yFormat={num}
          lines={perNode()}
        />
      </TabsContent>
      <TabsContent value="utilization">
        <Chart
          {...common}
          rows={nodeRows(current, "utilization")}
          yFormat={percent}
          yDomain={[0, 1]}
          lines={perNode()}
        />
      </TabsContent>
      <TabsContent value="breaker">
        {breakers.edges.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No edge in this scenario has a circuit breaker.
          </p>
        ) : (
          <Chart
            {...common}
            rows={breakers.rows}
            step
            yDomain={[0, 2]}
            yFormat={(v) => BREAKER_LABELS[Math.round(v)] ?? ""}
            lines={breakers.edges.map((id, i) => ({
              key: id,
              name: id,
              color: SERIES_COLORS[i % SERIES_COLORS.length] ?? "#000",
            }))}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
