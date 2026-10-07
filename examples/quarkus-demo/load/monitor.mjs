// Polls GET /probe on every demo service while a load test runs and writes a timeline.
// Usage: node load/monitor.mjs <label> [seconds=130] [intervalMs=500]
// Start it right before `docker compose run --rm k6`. Needs Node 18+ (global fetch).
import { mkdirSync, writeFileSync } from "node:fs";

const SERVICES = {
  gateway: "http://localhost:8080",
  order: "http://localhost:8081",
  payment: "http://localhost:8082",
  "external-payment": "http://localhost:8083",
};

const label = process.argv[2] ?? "run";
const seconds = Number(process.argv[3] ?? 130);
const intervalMs = Number(process.argv[4] ?? 500);
const samples = Object.fromEntries(Object.keys(SERVICES).map((s) => [s, []]));
const start = Date.now();

async function poll() {
  const t = Date.now() - start;
  await Promise.all(
    Object.entries(SERVICES).map(async ([name, url]) => {
      try {
        const res = await fetch(`${url}/probe`, { signal: AbortSignal.timeout(intervalMs) });
        samples[name].push({ t, ...(await res.json()) });
      } catch {
        samples[name].push({ t, unreachable: true });
      }
    }),
  );
}

console.log(
  `monitor: polling ${Object.keys(SERVICES).join(", ")} every ${intervalMs} ms for ${seconds} s`,
);
const timer = setInterval(poll, intervalMs);
setTimeout(() => {
  clearInterval(timer);
  mkdirSync("results", { recursive: true });
  const file = `results/timeline-${label}.json`;
  writeFileSync(file, JSON.stringify({ label, intervalMs, samples }, null, 1));
  console.log(`monitor: wrote ${file}`);
}, seconds * 1000);
