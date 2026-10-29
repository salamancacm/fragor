// Cuts the importer's real-data fixtures out of a capture of the Quarkus demo.
//
// How the capture is made (examples/quarkus-demo/README.md, "Capturing traces"):
//   MAVEN_OPTS="-Djavax.net.ssl.trustStoreType=Windows-ROOT" mvn -Ptelemetry package -DskipTests
//   docker compose -f docker-compose.yml -f docker-compose.telemetry.yml up -d --build
//   (warm up, restart the collector for a clean file, then) RATE=30 docker compose ... run --rm k6
// which leaves examples/quarkus-demo/results/telemetry/traces.jsonl (the Collector's file exporter).
//
// Usage: node make-fixtures.mjs <traces.jsonl>
//
// The spans are the real ones (ids, times, names, kinds, parents, status, in OTLP JSON). Only the
// attributes are reduced, to those the importer reads, and resources to service.name, to keep the
// files small. Nothing is invented or edited.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEEP = new Set([
  "http.response.status_code",
  "server.address",
  "server.port",
  "url.full",
  "error.type",
]);
const here = import.meta.dirname;
const raw = readFileSync(process.argv[2], "utf8").trim().split("\n");

const spans = [];
for (const line of raw)
  for (const rs of JSON.parse(line).resourceSpans) {
    const service = rs.resource.attributes.find((a) => a.key === "service.name").value.stringValue;
    for (const ss of rs.scopeSpans)
      for (const s of ss.spans) spans.push({ service, scope: ss.scope, span: s });
  }
const ms = (s) => Number(BigInt(s.startTimeUnixNano) / 1000n) / 1000;
const byTrace = new Map();
for (const x of spans) byTrace.set(x.span.traceId, [...(byTrace.get(x.span.traceId) ?? []), x]);
const rootOf = (t) => t.find((x) => !x.span.parentSpanId);

// k6 starts at the first second with a full rate (the first few traces are stragglers of the warm-up).
const roots = [...byTrace.values()]
  .map(rootOf)
  .filter(Boolean)
  .sort((a, b) => ms(a.span) - ms(b.span));
const perSecond = new Map();
for (const r of roots)
  perSecond.set(
    Math.floor(ms(r.span) / 1000),
    (perSecond.get(Math.floor(ms(r.span) / 1000)) ?? 0) + 1,
  );
const k6Start = [...perSecond.entries()].sort((a, b) => a[0] - b[0]).find(([, n]) => n >= 25)[0];

const reduce = (x) => ({
  ...x.span,
  attributes: (x.span.attributes ?? []).filter((a) => KEEP.has(a.key)),
});
function write(name, traces, note) {
  const lines = [];
  const all = traces.flat();
  for (let i = 0; i < all.length; i += 400) {
    const byService = new Map();
    for (const x of all.slice(i, i + 400))
      byService.set(x.service, [...(byService.get(x.service) ?? []), x]);
    lines.push(
      JSON.stringify({
        resourceSpans: [...byService].map(([service, xs]) => ({
          resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
          scopeSpans: [{ scope: xs[0].scope, spans: xs.map(reduce) }],
        })),
      }),
    );
  }
  writeFileSync(join(here, name), `${lines.join("\n")}\n`);
  console.log(name, traces.length, "traces", all.length, "spans", note);
}

// A calm, complete window: every request that started in 3 s, well before the fault (10 s into the run).
const calmFrom = (k6Start + 3) * 1000;
const calm = [...byTrace.values()].filter((t) => {
  const r = rootOf(t);
  return r && ms(r.span) >= calmFrom && ms(r.span) < calmFrom + 3000;
});
write("demo-calm.jsonl", calm, `window starts at ${new Date(calmFrom).toISOString()}`);

// A selection of the interesting requests of the run with the fault: retried, rejected, timed out.
const attempts = (t) => {
  const byParent = new Map();
  for (const x of t)
    if (x.service === "order" && x.span.kind === 3)
      byParent.set(x.span.parentSpanId, (byParent.get(x.span.parentSpanId) ?? 0) + 1);
  return Math.max(0, ...byParent.values());
};
const status = (x) => x.span.status?.code === 2;
const sample = (list, n) =>
  list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
const all = [...byTrace.values()]
  .filter(rootOf)
  .sort((a, b) => ms(rootOf(a).span) - ms(rootOf(b).span));
const three = sample(
  all.filter((t) => attempts(t) === 3),
  5,
);
const two = sample(
  all.filter((t) => attempts(t) === 2),
  8,
);
const rejected = sample(
  all.filter((t) => t.some((x) => x.service === "order" && x.span.kind === 2 && status(x))),
  8,
);
const timedOut = sample(
  all.filter(
    (t) =>
      t.some((x) => x.service === "gateway" && x.span.kind === 2 && status(x)) &&
      !t.some((x) => x.service === "order" && status(x)),
  ),
  8,
);
const calmSome = sample(all.filter((t) => attempts(t) === 1).slice(0, 200), 6);
const trouble = [...new Set([...three, ...two, ...rejected, ...timedOut, ...calmSome])];
write(
  "demo-trouble.jsonl",
  trouble,
  `${three.length} with 3 attempts, ${two.length} with 2, ${rejected.length} rejected, ${timedOut.length} timed out`,
);
