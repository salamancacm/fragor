// Builds the validation report: real runs (from load/validate.sh) against the Fragor mirror
// scenario run with several seeds at the same load.
// Usage: node load/validation-report.mjs [seeds=10]   (run from examples/quarkus-demo, CLI built)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const SEEDS = Number(process.argv[2] ?? 10);
const CLI = "../../packages/cli/dist/fragor.mjs";
const MIRROR = {
  timeout: "fragor/baseline.json",
  readtimeout: "fragor/baseline-read-timeout.json",
};
const CONFIG_LABEL = {
  timeout: "@Timeout (model: caller-pool)",
  readtimeout: "read-timeout (model: timer)",
};

/** Real runs grouped by config and rate. */
const groups = new Map();
for (const file of readdirSync("results").filter((f) => /^summary-validation-.*\.json$/.test(f))) {
  const s = JSON.parse(readFileSync(`results/${file}`, "utf8"));
  const [, config, rate] = /^validation-(\w+)-r(\d+)-\d+$/.exec(s.label) ?? [];
  if (config === undefined) continue;
  const key = `${config}|${rate}`;
  groups.set(key, [...(groups.get(key) ?? []), s]);
}

const realMetrics = (s) => ({
  success: s.success / s.roots,
  failed: s.failed / s.roots,
  p50: s.latencyMs.p50,
  p95: s.latencyMs.p95,
  p99: s.latencyMs.p99,
});

function modelRuns(config, rate) {
  const runs = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const out = execFileSync(
      "node",
      [
        CLI,
        "run",
        MIRROR[config],
        "--json",
        "--seed",
        String(seed),
        "--set",
        `traffic.web.pattern.rps=${rate}`,
      ],
      { maxBuffer: 1 << 30, encoding: "utf8" },
    );
    const s = JSON.parse(out).summary;
    runs.push({
      success: s.success / s.roots,
      failed: s.failed / s.roots,
      p50: s.p50Ms,
      p95: s.p95Ms,
      p99: s.p99Ms,
    });
  }
  return runs;
}

const stats = (xs) => ({
  mean: xs.reduce((a, b) => a + b, 0) / xs.length,
  min: Math.min(...xs),
  max: Math.max(...xs),
});
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const fmt = (st, f) => `${f(st.mean)} (${f(st.min)}–${f(st.max)})`;

const METRICS = [
  ["success", "Success", pct],
  ["failed", "Failed", pct],
  ["p50", "p50", ms],
  ["p95", "p95", ms],
  ["p99", "p99", ms],
];

const lines = [
  `# Validation: real services vs Fragor`,
  "",
  `Real: one row per load, mean (min–max) over the repeated runs. Model: the mirror scenario at the same load, mean (min–max) over ${SEEDS} seeds. "Gap" is model mean minus real mean.`,
  "",
];
const keys = [...groups.keys()].sort((a, b) => {
  const [ca, ra] = a.split("|");
  const [cb, rb] = b.split("|");
  return ca === cb ? Number(ra) - Number(rb) : ca < cb ? 1 : -1;
});
for (const key of keys) {
  const [config, rate] = key.split("|");
  const real = groups.get(key).map(realMetrics);
  const model = modelRuns(config, Number(rate));
  lines.push(
    `## ${CONFIG_LABEL[config]}, ${rate} rps (${real.length} real runs, ${model.length} seeds)`,
    "",
  );
  lines.push("| Metric | Real | Fragor | Gap |", "| --- | --- | --- | --- |");
  for (const [k, label, f] of METRICS) {
    const r = stats(real.map((x) => x[k]));
    const m = stats(model.map((x) => x[k]));
    const gap =
      k === "success" || k === "failed"
        ? `${((m.mean - r.mean) * 100).toFixed(1)} pp`
        : `${m.mean - r.mean >= 0 ? "+" : "−"}${ms(Math.abs(m.mean - r.mean))}`;
    lines.push(`| ${label} | ${fmt(r, f)} | ${fmt(m, f)} | ${gap} |`);
  }
  lines.push("");
}
const report = lines.join("\n");
writeFileSync("results/validation.md", report);
console.log(report);
