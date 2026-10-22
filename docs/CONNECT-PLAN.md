# Connecting running services to Fragor: plan

Status: **proposed** (2026-10-22), nothing here is built. Today Fragor asks you to *describe* your
system (quick form or JSON). This plan lets a developer point Fragor at services they run, locally
or in a real environment, and get a calibrated scenario to break. Decisions go to
[DECISIONS.md](DECISIONS.md) once approved.

## 1. Goal

From telemetry a service already produces, build a Fragor scenario that is **calibrated** (its
numbers come from observation, and each says where it came from) and **validated** (a report of how
closely the model reproduces what was observed), so the what-if experiments mean something.

"Connect" means *import*, not *instrument*: Fragor reads traces, metrics and configuration. It never
changes a running service.

## 2. Principles

1. **Import, don't intervene.** Read-only. No traffic is generated against a non-local host.
2. **Private by default.** The web app sends nothing anywhere. A live query (to Prometheus, Jaeger)
   is made by the CLI on the developer's machine, to URLs they give; credentials come from an
   environment variable, are sent only to that URL and are never stored or logged. `--anonymize`
   renames services and drops attributes before a scenario is shared.
3. **Provenance on every number.** Each parameter of an imported scenario is `observed`, `inferred`
   (with the rule), `config`, `user` or `assumed` (with the default visible). The UI shows it. A
   missing value is asked for or marked `assumed`, never silently invented.
4. **Validate before trusting.** The draft is simulated at the observed load and compared with what
   was observed, per service and edge.
5. **No mocks.** Importers are tested with real telemetry from the Quarkus demo.

## 3. What the developer does (target experience)

**Local service (Quarkus dev mode):**

1. Add the OpenTelemetry and Micrometer extensions, point the OTLP exporter at a local collector
   (a docker compose recipe is provided).
2. Exercise the service as usual (a browser, `curl`, k6).
3. `fragor import traces ./traces.jsonl --metrics <scrape url or file>` writes `draft.json` and a
   report of what was observed, inferred and assumed.
4. Open *Your scenario → Import* in the web app (or `fragor run draft.json`), fill the few
   questions (threads, queue size), and run.
5. `fragor validate` shows how close the model is. Then break something and compare.

**Real environment:** the same, pointing the CLI at the existing Jaeger/Tempo and Prometheus, with a
time window (for example the last peak hour). Nothing is pushed anywhere.

## 4. What can be learned, and from where

| Scenario parameter | Traces (OpenTelemetry) | Metrics (Micrometer / Prometheus) | Config / code | Ask |
| --- | --- | --- | --- | --- |
| Services and calls | client span → server span of the callee | partial | REST client config | no |
| Traffic (req/s) | root spans per second (if sampled, scale up) | rate of `http_server_requests_seconds_count` | | no |
| Own service time (p50/p99) | server span minus its child client spans (inferred) | server timer; **percentiles need a `MeterFilter`** | | if missing |
| Dependency latency, errors | client span durations and status | client timer (names not verified) | | no |
| Call probability per edge | child spans per parent span | | | no |
| Retries | several client spans from one parent to one target (inferred) | retry metrics (names not verified) | `@Retry` | no |
| Timeout value | client spans cluster at one duration with an error (inferred) | | `@Timeout`, read timeout | if unclear |
| Breaker, bulkhead, fallback | not observable (fallback use is) | `fallback` tag of `ft.invocations.total` | annotations, config | yes |
| Workers, queue limit | no | pool metric names not verified | `quarkus.thread-pool.max-threads`, `quarkus.thread-pool.queue-size` | yes |

The last row's keys are exactly the ones the Quarkus demo sets and the validation confirms.

### Verified against the official documentation (2026-10-22)

- **OTLP/JSON** ([spec](https://opentelemetry.io/docs/specs/otlp/)): trace and span ids are hex
  strings (not base64), 64-bit integers are decimal strings, enums are integers, keys are
  lowerCamelCase; OTLP/HTTP defaults to port 4318 and path `/v1/traces`.
- **Quarkus tracing** ([guide](https://quarkus.io/guides/opentelemetry-tracing)): REST server and
  REST client are instrumented; `quarkus.otel.instrument.*` turns instrumentation off;
  `quarkus.otel.exporter.otlp.endpoint` defaults to `http://localhost:4317` (gRPC); a console
  exporter exists (`quarkus.otel.traces.exporter=logging`); a JSON file exporter is **not**
  documented.
- **Collector file exporter** ([README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/fileexporter/README.md)):
  writes newline-delimited OTLP JSON, one line per batch; `json` is the default format; traces are
  at alpha stability. The page does not say which message type each line holds.
- **Jaeger** ([APIs](https://www.jaegertracing.io/docs/latest/apis/)): the UI's `/api/*` JSON is
  "intentionally undocumented and subject to change"; the stable query API is `/api/v3/*` on port
  16686 (gRPC on 16685).
- **Prometheus** ([HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)):
  `/api/v1/query` and `/api/v1/query_range` (`query`, `start`, `end`, `step`); responses are
  `vector` / `matrix` with `[unix_time, "value"]` samples.
- **Quarkus Micrometer** ([guide](https://quarkus.io/guides/telemetry-micrometer)):
  `http_server_requests_seconds_count`, `_sum` and `_max`; binders such as
  `quarkus.micrometer.binder.http-server.enabled`; percentile histograms are enabled with a
  `MeterFilter` (`percentilesHistogram(true)`), no property is documented.
- **SmallRye Fault Tolerance metrics** ([reference](https://smallrye.io/docs/smallrye-fault-tolerance/6.11.4/reference/metrics.html)):
  `ft.invocations.total` with tags `method` (fully qualified), `result` (`valueReturned` or
  `exceptionThrown`) and `fallback` (`applied`, `notApplied`, `notDefined`); Micrometer uses the
  same names and tags; quantiles need a `MeterFilter`.

### UNVERIFIED (to settle in the spike of M9/M10, never assumed)

- The property that makes Quarkus export OTLP over HTTP instead of gRPC, and whether the Collector
  bridge needs it.
- Parameters of Jaeger's `/api/v3` trace query.
- The names of the other `ft.*` metrics (timeout, retry, circuit breaker, bulkhead), the REST
  client metric names, and thread-pool metric names.
- Whether retries of a REST client call appear as separate client spans.
- The maximum points per series of a Prometheus range query (query in chunks to be safe).
- The default Prometheus scrape path in Quarkus (`/q/metrics` is expected).

## 5. Design

```
traces file / Jaeger v3        metrics file / Prometheus        application.properties
        │                              │                                 │
        └────────────── importers (pure, no network, @fragor/importers) ─┘
                                       │
                          ObservedSystem  (versioned JSON, every field Sourced<T>)
                                       │
                         buildScenario(observed, answers)  →  Scenario + import report
                                       │
                          simulate()  →  validate(observed)  →  fit report
```

- `ObservedSystem`: services, calls, traffic windows, latency quantiles and error rates, each as
  `{ value, from, detail }` with `from` one of `observed | inferred | config | user | assumed`.
- The CLI does the I/O (files, HTTP); the importers are pure functions, so the web app can run the
  same code on a file the user drops in, entirely in the browser.
- No new runtime dependency is planned: the OTLP/JSON, Prometheus text and JSON formats need only
  `JSON.parse` and a small parser. Reading OTLP **protobuf** would need a decoder, which is a
  reason to prefer the Collector's JSON output.

## 6. Milestones

Each one closes as usual: lint, typecheck, tests, evidence, decisions, then waits for approval.
Effort is relative (S, M, L).

| | Scope | Acceptance | Effort |
| --- | --- | --- | --- |
| **M8** | `ObservedSystem` types, provenance, `buildScenario`, the import report, versioned JSON Schema | Fixtures built by hand produce valid scenarios; every field carries its source; deterministic output | M |
| **M9** | Traces: OTLP/JSON(L) parser to `ObservedSystem`; infer topology, probabilities, attempts, timeout, self time; `fragor import traces`; web *Import* tab. **Starts with a spike** that adds OpenTelemetry to the Quarkus demo and settles the UNVERIFIED items | Demo traces give the four-service chain, retries and the 2 s timeout of `order → payment` | L |
| **M10** | Metrics: Prometheus text parser and read-only HTTP client; rate, errors, latency, fallback use; documented `MeterFilter` for percentiles, with a clear fallback (mean and max) marked `assumed` | Demo metrics agree with the traces to within sampling error | M |
| **M11** | `fragor validate` and a *How close is the model?* panel: simulated vs observed per service and edge, the largest gaps, which `assumed` values matter most (sensitivity) | On the demo, the same tolerances as the existing [validation matrix](../examples/quarkus-demo/README.md) | M |
| **M12** | Local lab recipe (compose with a collector); `application.properties` reader; optionally a Quarkus extension that reads annotations at build time for exact policy parameters, and export back to `application.properties` and annotations | Round trip on the demo: import, change a policy, export, the demo config matches | L |

Later, if wanted: Zipkin and Tempo, Envoy / Istio metrics (topology without touching the app),
Spring Boot via Micrometer, other languages through OpenTelemetry.

## 7. Ground truth

The Quarkus demo is the test bed: its hand-written mirror scenarios and the measured
[validation](../examples/quarkus-demo/README.md) say what a correct import should reproduce. The
target for M11 is the same order of agreement (success within a couple of points); it is a target,
not a promise, and gaps will be reported rather than tuned away.

## 8. Risks

- **Sampling and instances.** Traces may be sampled and services run several instances: rates come
  from metrics when available, otherwise scaled by the sampling ratio, and the report says so.
- **Self time is inferred.** With parallel or asynchronous calls, "server span minus children" is an
  approximation; it is marked `inferred` and checked by M11.
- **Telemetry may lack what we need** (no percentile histogram, no per-attempt spans). The import
  report lists exactly what is missing and how to enable it.
- **Instrumentation APIs move.** Jaeger's `/api/*` is internal, so only the stable `/api/v3/*` and
  files are supported.

## 9. Recommended decisions (for approval)

1. **Traces first, then metrics.** Traces are language-agnostic and give topology; metrics add
   rates and policy outcomes.
2. **CLI for live queries, file import for the web app.** A browser calling a local Prometheus or
   Jaeger runs into CORS and mixed-content rules, and a file keeps the "nothing leaves your browser"
   promise simple.
3. **Generic OpenTelemetry before anything Quarkus-specific.** The Quarkus extension and the export
   back to `application.properties` come last, once the import is trusted.

## 10. Out of scope

Changing running services, generating load against non-local hosts, AI features (rule 10 of the
project rules), a hosted service.
