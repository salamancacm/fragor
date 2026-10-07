// k6 load test that reproduces Fragor scenario 01/02 against the real services:
// 100 requests per second for 60 s (open model, like Fragor), and the external payment API made
// 5 s slower from t = 10 s to t = 40 s.
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

const GATEWAY = __ENV.GATEWAY_URL || "http://localhost:8080";
const ADMIN = __ENV.ADMIN_URL || "http://localhost:8083";
const LABEL = __ENV.RUN_LABEL || "run";
const RATE = Number(__ENV.RATE || 100);

const success = new Counter("roots_success");
const degraded = new Counter("roots_degraded");
const failed = new Counter("roots_failed");
// End-to-end latency of every completed request (success, degraded and failed), as in Fragor.
const latency = new Trend("roots_latency", true);

export const options = {
  scenarios: {
    load: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 1000,
      maxVUs: 8000,
      gracefulStop: "60s",
      exec: "checkout",
    },
    slowDown: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "10s",
      exec: "slowDown",
    },
    restore: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "40s",
      exec: "restore",
    },
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

export function checkout() {
  const res = http.post(`${GATEWAY}/checkout`, null, { timeout: "60s" });
  latency.add(res.timings.duration);
  if (res.status === 200 && res.body === "ordered") success.add(1);
  else if (res.status === 200 && res.body === "ordered-degraded") degraded.add(1);
  else failed.add(1);
}

export function slowDown() {
  http.post(`${ADMIN}/admin/latency?extraMs=5000`);
}

export function restore() {
  http.del(`${ADMIN}/admin/latency`);
}

function value(data, metric, stat) {
  const m = data.metrics[metric];
  return m === undefined ? 0 : m.values[stat];
}

export function handleSummary(data) {
  const ok = value(data, "roots_success", "count");
  const deg = value(data, "roots_degraded", "count");
  const bad = value(data, "roots_failed", "count");
  const roots = ok + deg + bad;
  const pct = (n) => (roots === 0 ? "-" : `${((100 * n) / roots).toFixed(1)}%`);
  const ms = (stat) => `${Math.round(value(data, "roots_latency", stat))} ms`;
  const summary = {
    label: LABEL,
    rate: RATE,
    roots,
    success: ok,
    degraded: deg,
    failed: bad,
    droppedIterations: value(data, "dropped_iterations", "count"),
    latencyMs: {
      avg: value(data, "roots_latency", "avg"),
      p50: value(data, "roots_latency", "med"),
      p95: value(data, "roots_latency", "p(95)"),
      p99: value(data, "roots_latency", "p(99)"),
    },
  };
  const text = [
    `Real services (${LABEL})`,
    `  roots      ${roots} (dropped by k6: ${summary.droppedIterations})`,
    `  success    ${pct(ok)}`,
    `  degraded   ${pct(deg)}`,
    `  failed     ${pct(bad)}`,
    `  latency    avg ${ms("avg")} / p50 ${ms("med")} / p95 ${ms("p(95)")} / p99 ${ms("p(99)")}`,
    "",
  ].join("\n");
  return {
    stdout: text,
    [`/results/summary-${LABEL}.json`]: JSON.stringify(summary, null, 2),
  };
}
