// Side by side, every 2 s: what each real service did (from load/monitor.mjs) and what the Fragor
// model computed for the same service (from `fragor run --json`).
// Usage: node load/compare.mjs results/timeline-<label>.json results/fragor-<label>.json
import { readFileSync } from "node:fs";

const [timelineFile, fragorFile] = process.argv.slice(2);
if (timelineFile === undefined || fragorFile === undefined) {
  console.error("usage: node load/compare.mjs <timeline.json> <fragor-result.json>");
  process.exit(2);
}
const timeline = JSON.parse(readFileSync(timelineFile, "utf8"));
const result = JSON.parse(readFileSync(fragorFile, "utf8"));
const services = Object.keys(timeline.samples);
const STEP_S = 2;

// The real t = 0 is the first sample in which the gateway had received traffic.
const firstTraffic = timeline.samples.gateway.find((s) => (s.arrived ?? 0) > 0);
const t0 = (firstTraffic?.t ?? 0) - timeline.intervalMs;

function realAt(service, tS) {
  const list = timeline.samples[service].filter((s) => !s.unreachable && s.t - t0 <= tS * 1000);
  return list.at(-1);
}

function realRejectedPerS(service, tS) {
  const now = realAt(service, tS);
  const before = realAt(service, tS - STEP_S);
  return now === undefined || before === undefined
    ? 0
    : (now.rejected503 - before.rejected503) / STEP_S;
}

function sim(service, tS) {
  const s = result.series.nodes[service];
  const i = Math.floor((tS * 1000) / result.series.bucketMs);
  if (s === undefined || i >= result.series.buckets) return { busy: 0, queue: 0, rejected: 0 };
  const workers = (realAt(service, tS)?.workers ?? 0) || 1;
  return {
    busy: Math.round((s.utilization?.[i] ?? 0) * workers),
    queue: Math.round(s.queueDepthAvg?.[i] ?? 0),
    rejected: ((s.rejected503[i] ?? 0) * 1000) / result.series.bucketMs,
  };
}

const cell = (real, model) => `${String(real).padStart(4)}/${String(model).padEnd(4)}`;
console.log(
  "Each cell: real/model. busy = threads in use, queue = waiting for a thread, 503 = rejections per second",
);
console.log(`${"t(s)".padStart(4)} | ${services.map((s) => s.padEnd(27)).join("| ")}`);
console.log(
  `${"".padStart(4)} | ${services.map(() => "busy      queue     503/s    ").join("| ")}`,
);
const lastS = Math.min(
  Math.ceil((timeline.samples.gateway.at(-1).t - t0) / 1000),
  Math.ceil((result.series.buckets * result.series.bucketMs) / 1000) + 6,
);
for (let t = STEP_S; t <= lastS; t += STEP_S) {
  const cols = services.map((svc) => {
    const r = realAt(svc, t);
    const m = sim(svc, t);
    if (r === undefined) return "-".padEnd(27);
    return `${cell(r.inService, m.busy)} ${cell(r.waiting, m.queue)} ${cell(Math.round(realRejectedPerS(svc, t)), Math.round(m.rejected))}`;
  });
  console.log(`${String(t).padStart(4)} | ${cols.join("| ")}`);
}

console.log("");
console.log("Totals during the run (real/model): requests, 503 rejections, orphaned work");
for (const svc of services) {
  // Probe counters are cumulative since the container started: subtract the first sample.
  const reachable = timeline.samples[svc].filter((s) => !s.unreachable);
  const first = reachable[0];
  const lastSample = reachable.at(-1);
  const delta = (k) => (lastSample?.[k] ?? 0) - (first?.[k] ?? 0);
  const r = {
    arrived: delta("arrived"),
    rejected503: delta("rejected503"),
    orphanedWork: delta("orphanedWork"),
  };
  const s = result.series.nodes[svc];
  const sum = (xs) => (xs ?? []).reduce((a, b) => a + b, 0);
  console.log(
    `  ${svc.padEnd(17)} ${cell(r?.arrived ?? 0, sum(s?.arrivals))}  ${cell(r?.rejected503 ?? 0, sum(s?.rejected503))}  ${cell(r?.orphanedWork ?? 0, sum(s?.orphanedWork))}`,
  );
}
