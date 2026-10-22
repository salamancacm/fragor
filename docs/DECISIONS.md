# Decisions

Short ADR log. Newest at the bottom. Format: date, context, decision, alternatives.

## Tool versions (installed with `pnpm add`, 2026-10-06)

| Tool | Version | Why |
| --- | --- | --- |
| Node | 24.21.0 (LTS "Krypton") | pinned via `devEngines.runtime`; `.nvmrc` = 24, `engines.node` >= 24 |
| pnpm | 10.18.3 | workspaces |
| typescript | ^7.0.2 | strict typing (engine runs in browser and Node) |
| @biomejs/biome | ^2.5.15 | single lint + format tool |
| vitest | ^5.0.3 | tests and benchmarks |
| fast-check | ^4.10.2 | property-based tests of engine invariants |
| @types/node | ^24 | matches the Node 24 runtime; used only by tooling, not by the engine |

Runtime dependencies of `@fragor/engine`: none (by design). Zod will be added only to
`packages/scenarios` in M3, with justification then.

## 2026-10-06 — Monorepo with pnpm workspaces
Context: engine must be isomorphic; UI and CLI consume it. Decision: pnpm workspaces,
`packages/*` and `apps/*`. Alternatives: npm/yarn workspaces, Turborepo (unneeded for now).

## 2026-10-06 — Packages created when needed
Context: the brief lists `scenarios`, `cli`, `web`. Decision: M0 creates only `engine`; the others
are created in the milestone that needs them, to avoid empty packages. Alternative: empty
placeholders (rejected).

## 2026-10-06 — Engine consumed as TypeScript source
Decision: `@fragor/engine` exports `./src/index.ts` directly; no build step yet, so tests and
typecheck run without compiling. A build step (and the CI `build` job) is added when a package
needs one (CLI in M3, web in M4).

## 2026-10-06 — Root scripts call tools directly (no nested `pnpm -r`)
Context: on Windows, with the runtime pinned by `devEngines`, a `pnpm` invoked from inside a
script fails (the globally installed pnpm launcher cannot start the project-local `node` shim).
Decision: root scripts call tools directly: `vitest run` with `test.projects: ["packages/*"]` in
`vitest.config.ts`, and `tsc -p <package>` per package for typecheck. Alternatives: `pnpm -r`
(broken locally), a custom runner script (more code), dropping the Node pin (rejected).

## 2026-10-06 — Node version
Context: the author asked for the current LTS (Node 24). The machine has Node 22 globally and no
version manager. Decision: pin Node 24.21.0 with pnpm `devEngines.runtime` (`onFail: "download"`):
pnpm downloads that runtime into the project and runs every script with it, without touching the
global installation. `.nvmrc` = 24 for CI and other tools. Alternatives: install Node 24 globally or
via nvm-windows (changes the machine), or keep 22 (not the active LTS).

## 2026-10-06 — Commit attribution disabled
Decision: `.claude/settings.json` sets `attribution.commit` and `attribution.pr` to empty strings
and `sessionUrl` to false. Confirmed in the official settings reference
(https://code.claude.com/docs/en/settings-reference.md#attribution): `attribution` replaces the
deprecated `includeCoAuthoredBy`; empty strings work on every version, while `attribution: false`
requires v2.1.281+.

## 2026-10-06 — License
Decision: `"license": "UNLICENSED"` and `"private": true`. **The license is pending the author's
decision.**

## 2026-10-06 — M1: event kernel with closures and lazy cancellation
Context: the kernel must not know about nodes or policies (extensibility). Decision: each event
carries its `kind` and a `fire` closure; cancelled events are skipped when popped. Alternatives:
a central `switch` over event kinds with payloads (couples the kernel to every feature), eager
heap removal (O(n) per cancel).

## 2026-10-06 — M1: per-purpose RNG sub-streams
Decision: streams are derived from `hash(seed, kind, id, purpose)` (e.g. `node/svc/service` and
`node/svc/error`), finer than one stream per entity. Error decisions are always drawn. Why: what-if
comparisons keep more random numbers in common (changing `errorRate` does not reshuffle service
times). Alternative: one stream per entity (simpler, more coupling between parameters).

## 2026-10-06 — M1: histogram over integer nanoseconds
Decision: log-linear histogram with 128 sub-buckets per octave over `floor(ms * 1e6)`, index
computed with `Math.clz32` and exact divisions by powers of two. Why: bucket assignment is
bit-identical on every JS engine (no `Math.log`), error <= 0.5% (< 1% required). Alternatives:
`Math.log`-based buckets (engine-dependent rounding at boundaries), storing raw latencies
(memory grows with traffic; forbidden by the brief).

## 2026-10-06 — M1: full-width buckets and lazy bucket closing
Decision: the kernel calls `metrics.advanceTo(t)` before every event; METRICS_TICK only keeps
series current while streaming and stops when no work is pending after `durationMs`. Every
bucket spans a full `bucketMs`. Alternative: partial last bucket (made the last value depend on
whether a tick happened to fire).

## 2026-10-06 — M1: result fields that deviate from the brief's sketch
- Latency summary fields and percentiles are `number | null` (null when there is no sample) to
  keep the result pure JSON (no NaN).
- `Series` is one shape for global, nodes and edges; fields that do not apply to an entity kind
  (`queueDepthAvg`, `queueDepthMax`, `utilization`, `breakerState`) are `null` as a whole.
- Added `resultSchemaVersion: 1` and `series.buckets`.
- Summary latency covers every completed root (success, degraded and failed);
  `goodputRps = success / (durationMs / 1000)`.

## 2026-10-06 — M1: deterministic bottom-k trace sampling
Decision: keep the `maxTraces` roots with the smallest `hash(seed, rootId)`. Why: deterministic,
uniform over the whole run, independent of event timing, bounded memory. Alternatives: first N
roots (biased to warm-up), reservoir sampling (depends on arrival order).

## 2026-10-06 — M1: separate tsconfig for tests
Decision: `packages/engine/tsconfig.json` covers `src/` with `types: []` and lib ES2022 only (no
DOM, no Node globals); `packages/engine/test/tsconfig.json` adds Node types for tests. Why: the
compiler rejects any Node/DOM API in engine sources. A test also checks that `src/` imports only
relative modules.

## 2026-10-06 — M1: spike and ramp timing
Decision: `ramp.durationMs` is relative to the source's `startMs`; `spike.atMs` is absolute
scenario time, and the spike ramps down over the same `rampMs` it ramped up. Both are
non-homogeneous Poisson processes (thinning). `constant` is evenly spaced, first arrival at
`startMs`.

## 2026-10-06 — M2: semantics verified against SmallRye 6.11.4 source, not only docs
Context: the MicroProfile spec leaves details open (half-open concurrency, window reset, backoff
clamping, when maxDuration is checked). Decision: follow SmallRye Fault Tolerance 6.11.4 (the
implementation used by Quarkus), reading its source where the docs are silent; cite both in
SEMANTICS.md. The latest SmallRye release is 7.0.0, but its documentation was not published at
the time of writing, so 6.11.4 is the reference. Alternative: spec-only semantics (ambiguous).

## 2026-10-06 — M2: failure kind vs root cause
Decision: a caller's policies see a failed dependency of its callee as `http-5xx` (the callee
answers 500), while `summary.failureReasons` counts the root cause carried through 500 responses.
Why: policies must react to what the caller really observes, and the explanation of a failure
needs the origin (e.g. timeouts on a deep edge). Alternative: report only what the root sees
(everything would be http-5xx), or propagate the inner kind to policies (wrong retry decisions).

## 2026-10-06 — M2: bulkhead slot released when the caller stops waiting
Decision: semaphore semantics; the slot is released on response, timeout or cancellation.
`waitingTaskQueue` is honored whenever configured. Alternative: MicroProfile's @Asynchronous
variant where a timed-out execution keeps its slot until it returns (needs modeling the caller's
sync/async style; not in scope).

## 2026-10-06 — M2: cancelOnTimeout semantics
Decision: queued work is dropped; own service time cannot be interrupted but no calls follow;
work waiting on dependencies cancels them recursively and frees its worker immediately; requests
still on the wire are dropped on arrival. A cancelled half-open probe frees its slot (UNVERIFIED,
no SmallRye equivalent).

## 2026-10-06 — M2: summary additions
Added `summary.byTraffic` (outcomes and p50/p99 per traffic source; needed to show the blast
radius on /users), `summary.circuitOpen`, `summary.bulkheadFull`, `summary.fallbacks`, and the
per-bucket series `attempts`, `circuitOpen`, `bulkheadFull`, `fallbacks`. Trace spans gained
`attempt`, `orphaned` and `cancelled`. EdgeSnapshot gained bulkhead state. New event kind
FALLBACK_DONE for fallback latency.

## 2026-10-06 — M2: fault effects per target and combination rules
Decision: node: latency-add, latency-multiply, error-rate, outage, capacity; edge: latency-add,
latency-multiply, packet-loss, outage; traffic: traffic-multiply. Overlaps: sums for latency-add,
products for multiplicative effects, last started wins for error-rate, blackhole wins over refuse,
independent losses for packet-loss. Capacity drops never preempt running work.

## 2026-10-06 — M2: canonical scenarios live in @fragor/scenarios without Zod yet
Decision: `packages/scenarios` is created now with `examples/*.json` only (no dependencies, no
code). Zod schemas, JSON Schema export, applyPatch and findings arrive in M3. Engine tests read the
JSON files directly and rely on the engine's structural validation.

## 2026-10-06 — M2: benchmarks with the Vitest 5 bench fixture
Context: Vitest 5 replaced the top-level `bench()` with a `bench` fixture inside `test()` in
`*.bench.ts` files, run by `vitest bench`. Decision: `pnpm bench` runs them and asserts the
budget; they are not part of `pnpm test` nor CI (wall-clock timings are noisy on shared
runners). Vitest reports that module export getters inflate timings (Vite transforms the
engine's internal imports); measured numbers are therefore an upper bound.

## 2026-10-06 — M3: dependency versions

| Package | Dependency | Version | Why |
| --- | --- | --- | --- |
| @fragor/scenarios | zod | ^4.6.5 | user-facing validation with readable errors; `.exactOptional()` matches `exactOptionalPropertyTypes`; built-in `z.toJSONSchema` |
| @fragor/cli | esbuild (dev) | ^0.28.2 | bundles the CLI and the workspace packages into one `dist/fragor.mjs` |

Why a bundler: the engine is consumed as TypeScript source, uses constructor parameter
properties (which Node type stripping cannot run) and extensionless relative imports. esbuild is
a single, fast tool for that. Alternatives: `tsc` emit (needs import extensions rewritten
everywhere), `tsx` at runtime (heavier, slower startup). Its postinstall script is not needed
(the binary comes as an optional platform package), so it stays disabled
(`ignoredBuiltDependencies` in pnpm-workspace.yaml).

## 2026-10-06 — M3: schemas follow the engine types
Decision: Zod schemas are declared `satisfies z.ZodType<T>` against `@fragor/engine` types
(verified: a wrong field type or an extra field fails to compile). Objects are strict: unknown
keys (typos) are errors. Field-level rules live in Zod; cross references and relations
(ids, calls, cycles, maxMs >= minMs...) in `checkReferences`, attached with `superRefine`.
Error paths name collection items by id: `edges[order-payment].policies.timeout.valueMs`.

## 2026-10-06 — M3: JSON Schema is a committed, generated file
Decision: `packages/scenarios/schema/scenario.schema.json` (draft 2020-12) is generated from the
Zod schemas by `pnpm build && pnpm schema:update` and committed; a test fails when it is out of
date. It is excluded from Biome formatting (generated). `$id` is a URN
(`urn:fragor:schema:scenario:v1`) because the project owns no domain. Cross references cannot be
expressed in JSON Schema; they are listed in its top-level description.

## 2026-10-06 — M3: typed patches
Decision: `applyPatch(scenario, ops)` is pure and validates its output. Ops: `set`, `unset`,
`add-node`, `remove-node`, `add-edge` (optionally appending the call), `remove-edge`. `unset` was
added to the list in the brief because turning a policy off (breaker on/off) means removing it.
`remove-node` cascades to its edges, the calls to them and the faults on them, but refuses to
remove a node that receives traffic. Paths address `nodes`, `edges`, `traffic`, `faults` items by
id and other arrays by index; dotted paths require ids without dots (enforced by the schema).
`parsePatch` validates untrusted patch documents.

## 2026-10-06 — M3: findings are rules with thresholds, never free text
Decision: six deterministic rules (see ARCHITECTURE, "Analysis"), each with severity, a summary
built only from computed numbers, and evidence pointing at ids and time windows. Thresholds are
explicit (`DEFAULT_THRESHOLDS`) and overridable. Retry amplification separates attempts that
reached the dependency from attempts rejected by the breaker or bulkhead, so it does not claim
load that never happened. Alternative: thresholds hidden in code (not explainable).

## 2026-10-06 — M3: comparison lives in the engine
Decision: `compareResults(before, after)` is in `@fragor/engine` (metrics/comparison.ts): pure,
JSON output, shared by the CLI and the future UI. Verdicts depend on the better direction of each
metric; context metrics (roots, circuit open, bulkhead full, fallbacks) have no verdict.

## 2026-10-06 — M3: CLI without a parsing library
Decision: `node:util` `parseArgs`; `main(argv, io)` returns an exit code and receives its side
effects (stdout, stderr, files) so it is tested in-process. Exit codes: 0 ok, 1 runtime, 2 usage
or invalid input. `run --json` prints the SimulationResult, `run --digest` the analysis digest,
`compare --json` the comparison. CI builds the bundle and smoke-runs it.

## 2026-10-06 — M4: web dependency versions

| Package | Version | Why |
| --- | --- | --- |
| next | ^16.4.0 | App Router, static export (`output: "export"`), Turbopack, Web Worker bundling |
| react / react-dom | ^19.3.0 | UI |
| tailwindcss / @tailwindcss/postcss / postcss | ^4.3.3 / ^4.3.3 / ^8.5.29 | styling (Tailwind v4) |
| shadcn (dev), radix-ui, class-variance-authority, cn, lucide-react, tw-animate-css | ^4.21.3, ^1.7.0, ^0.7.1, ^0.4.0, ^1.52.0, ^1.4.0 | shadcn/ui components (preset radix-nova) and their runtime: `cn` is shadcn's class merger (github.com/shadcn-ui/cn) |
| @xyflow/react | ^12.12.0 | architecture graph (removed 2026-10-20, see below) |
| recharts | ^3.10.1 | time series |
| @types/react, @types/react-dom, @types/node | ^19.3.0, ^19.3.0, ^24 | typing |

## 2026-10-06 — M4: the web app is static and private by default
Decision: `output: "export"`; the engine runs in a Web Worker in the visitor's browser and no
server exists. No remote fonts (shadcn's Geist via `next/font/google` was removed in favor of a
system font stack), no analytics, and Next.js telemetry is disabled in every script
(`NEXT_TELEMETRY_DISABLED=1`; `.npmrc` sets `shell-emulator=true` so that syntax works on
Windows). Verified: the exported site only loads resources from its own origin.

## 2026-10-06 — M4: cross-engine determinism fixed in the engine
Context: the first browser run of scenario 01 gave a different fingerprint than Node. The
difference was one utilization value in the last bit, caused by `Math.log`/`Math.exp`/`Math.cos`
returning slightly different bits in Chrome and Node (ECMAScript allows implementation-approximated
results). Decision: `core/math.ts` implements `detLog` and `detExp` with basic arithmetic and exact
bit manipulation only; the normal sampler uses the Marsaglia polar method (no cosine); integer
powers use repeated multiplication. A purity test forbids platform transcendental functions and
`**` in the engine. Verified: the six canonical scenarios give identical fingerprints in Node 22,
Node 24 and the Chrome web worker. Cost: about 10 ms more for scenario 01 (still far within budget).
All fingerprints changed once (same distributions, different exact samples).

## 2026-10-06 — M4: UI parameters are patches
Decision: the parameters panel (traffic multiplier; per edge: timeout, retries, breaker on/off)
is turned into `PatchOp[]` by `patchFor` and applied with `applyPatch`, so every what-if is
validated and listed on screen. Adding retries to an edge without a policy uses the SmallRye
@Retry defaults (delay 0, jitter 200 ms); turning a breaker on uses the SmallRye @CircuitBreaker
defaults (window 20, ratio 0.5, delay 5000 ms, successThreshold 1).

## 2026-10-06 — M4: comparison is always "previous run vs this run"
Decision: each finished run becomes "current" and the one before "previous"; cards, the table
and the dashed lines in the charts compare them with `compareResults`. Runs of different scenarios
can be compared too (labels say which).

## 2026-10-06 — M4: tooling notes
- shadcn's CLI and any `pnpm` started from inside a pnpm script fail on Windows while the
  project-local Node shim is on PATH (see the M0 note). shadcn was run once with the shim moved
  aside; nothing in the repository depends on that workaround. Root scripts call `next` through
  `node apps/web/node_modules/next/dist/bin/next` for the same reason.
- `exactOptionalPropertyTypes` stays on for the web app; the one generated component that broke
  (slider) was fixed instead of relaxing the compiler.
- TypeScript 7 removed `baseUrl`; the `@/*` alias uses `paths` only.
- Web tests cover the pure logic (worker run loop and protocol, params to patches, graph layout,
  health colors, chart data). The UI itself was verified in a browser (dev server and static
  export).

## 2026-10-07 — Real-services comparison: per-service probes and the @Timeout finding
Context: the Quarkus demo disagreed with the model (success 72% real vs 49% model, p95 26 s vs
2.3 s). Decision: instrument every demo service with a dependency-free probe (`GET /probe`, served on
the Vert.x event loop) whose gauges match Fragor's definitions (waiting = queue depth, inService =
busy workers, orphanedWork), plus `load/monitor.mjs`, `load/compare.mjs` and `load/experiment.sh` to
compare real and model second by second. Result: the discrepancy comes from Quarkus/SmallRye, not
from the engine: a synchronous `@Timeout` is enforced by a task submitted to the saturated worker
pool, so it fires late or is lost. With the REST client `read-timeout` the model's assumption holds
and model and reality agree (49.5% vs 48.9% success; 15,172 vs 15,271 requests to payment; 11,304 vs
11,939 rejections). Alternatives considered: Micrometer/Prometheus (adds dependencies and its gauges
do not map one to one to the model's quantities). Open: modeling late/lost timeouts in the engine
(an option on the calling node: timeout enforcement through its own worker queue).

## 2026-10-07 — Timeout enforcement: "timer" or "caller-pool"
Context: the real-services comparison showed that a synchronous SmallRye @Timeout in Quarkus is
enforced through the caller's own worker pool, so it is late or lost exactly when the service is
overloaded; the engine assumed timeouts always fire on time. Decision: `TimeoutPolicy.enforcement`
(Fragor modeling extension, default "timer" so every existing scenario and fingerprint is
unchanged). "caller-pool" turns the timeout into a zero-duration task in the calling node's queue
(shared limit with requests, not counted in queueDepth); a full queue loses it; the read-timeout
default remains a backstop. New per-edge counters `timeoutsDelayed` and `timeoutsLost`, a
`timeout-starvation` finding, and a UI switch. Validated against the Quarkus demo: the model now
reproduces both real configurations (70.5% vs 71.8% success with @Timeout; 48.9% vs 49.5% with the
read-timeout). Alternatives: a node-level flag (less precise: the same service can use both kinds of
timeouts), modeling every SmallRye timer use (retry delays and breaker transitions are not affected
in synchronous mode).

## 2026-10-07 — Validation across loads and seeds
Context: the timeout-enforcement validation rested on one run per configuration. Decision: add a
repeatable matrix (`examples/quarkus-demo/load/validate.sh`: 3 loads x 2 timeout configurations x 3
runs, services restarted between runs) and a report against the mirror scenario over 10 seeds
(`load/validation-report.mjs`). Result: with `@Timeout` (caller-pool) the model holds at 50, 100 and
150 rps (success within 1.6 points, latency percentiles within tens of ms). With the read-timeout
(timer) outcomes hold at 50 and 100 rps but the model underestimates tail latency by about 2 s, and
at 150 rps it is off by 8 points. Cause found with the probes: when a caller closes the connection,
Quarkus drops the request still queued at the server but keeps running the one already in progress;
Fragor has no such mode (default: queued work runs; cancelOnTimeout: both are cancelled). Open:
model "drop queued work of a departed caller" and re-validate.

## 2026-10-08 — abandonedWork: drop the queued work of a departed caller
Context: the 2026-10-07 validation showed the read-timeout configuration off by 8 points at
150 rps and about 2 s short on tail latency at 50 and 100 rps. A probe showed why: when the caller
closes the connection, Quarkus never runs the request still queued at the server, while the one
already running goes on. Decision: new `options.abandonedWork: "continue" | "drop-queued" |
"cancel"` (default "continue"; `cancelOnTimeout: true` stays as an alias of "cancel" and a
contradiction between both is a validation error). With "drop-queued" an orphaned job is discarded
when a worker reaches it: no worker time, no reply, counted as `discardedWork` (new node series and
summary field); it keeps its queue slot until then. The four demo mirrors use it. Checked against
the 2026-10-07 real runs before re-running them: at 150 rps the model moves from 49.0% to 57.3%
success (real 57.1–57.4%), p50 from 0.28 s to 2.24 s (real 2.19–2.24 s); the @Timeout mirrors do
not change (nothing is discarded there). Alternatives: per-edge setting (rejected for now: it is the
server that discards, and every edge in the demo behaves the same); removing the request from the
queue at once when the caller leaves (rejected: the slot release was not observed, and the
dequeue-time skip reproduces the bursts seen in the real queue). Which Quarkus component skips the
request is UNVERIFIED.

## 2026-10-20 — M5: an animated replay instead of a static dashboard
Context: the web app showed the right numbers but did not tell what happened: a small graph frozen
at t = 0, eight equal cards, findings as raw evidence chips. Decision (after a mockup reviewed by
the author): one dark "control room" theme; a headline paragraph built from the run; five key
numbers with sparklines and their change against the previous run; the run replayed on a custom
SVG stage (cards with worker and queue gauges, two-lane links, a breaker gate, fault badges) with a
canvas of particles; a timeline with play, speed and seek; a narrated event feed; compact findings
that jump the replay. The narration (`events.ts`) and the headline (`story.ts`) are derived only from
the scenario, the result and the findings, with display thresholds named in code; particles use a
seeded PRNG and never feed back into any number. The replay clock lives outside React and
components subscribe to the current bucket, so the page re-renders once per simulated second.
`@xyflow/react` was removed: the stage needs per-link lanes, particles and gates that are simpler on
a plain SVG with our own layered layout (`graph-layout.ts` already existed); it saves a dependency.
Alternatives: keep React Flow with custom edges (heavier, two layout systems), animate in SVG only
(too many DOM nodes for hundreds of dots), a light theme too (deferred: one theme done well first).

## 2026-10-21 — Publishing the web app on GitHub Pages
Context: the app is a static export with no server, so any static host works; GitHub Pages is free
for public repositories. Decision: an optional `FRAGOR_BASE_PATH` (validated as `/name`) sets
Next's `basePath`, because a project site lives under `https://<user>.github.io/<repo>/`; local
development keeps `/`. `public/.nojekyll` stops Jekyll from hiding `_next/`. A separate
`pages.yml` workflow repeats the CI checks, takes the path from `actions/configure-pages` and
deploys with `upload-pages-artifact` + `deploy-pages`. Verified locally by serving the export under
`/fragor/` (worker, chunks and examples load; no console errors). Alternatives: a `gh-pages` branch
(commits build output to the repository), Netlify or Cloudflare Pages (another account; same build).
Pending: the repository, its visibility and the license are the author's decision.

## 2026-10-21 — License: Apache-2.0
Context: the 2026-10-06 entry left the license pending; publishing on GitHub Pages needs a public
repository. Decision (the author's): Apache License 2.0, with a NOTICE file. It is permissive like
MIT and adds an explicit patent grant; it is also the license of MicroProfile, SmallRye and Quarkus,
the ecosystem Fragor targets, so adopting it raises no new legal review there. Every current
dependency (MIT or Apache-2.0) is compatible. The packages stay `"private": true` (nothing is
published to npm). Alternatives: MIT (shorter, no patent grant), MPL-2.0 (file-level copyleft),
AGPL-3.0 (strong copyleft, including network use; deters adoption by companies).

## 2026-10-21 — M6: your own scenario in the web app
Context: the web app only ran the six examples, so a new user could not try their own service;
"how do I connect my microservice?" showed that Fragor's model (describe, do not connect) was not
obvious. Decision: a *Your scenario* panel with (1) a quick form for the most common case, one
service and one dependency, whose fields map to configuration and metrics a Quarkus user has at
hand (`lib/template.ts`: pure, validated with the same schema as the CLI); (2) a JSON tab for any
architecture (`lib/import.ts`: size limit, JSON syntax errors with line and column, schema issues
with the field path by id); (3) download of the scenario on screen. The user's scenario joins the
picker and works with *What if…*. Form and JSON are kept in `localStorage` (per-browser
convenience, wrapped in try/catch; the page works without it). Nothing is sent anywhere.
Alternatives: a full visual editor (larger; the JSON tab plus the form cover the need first),
importing from OpenTelemetry traces or Prometheus (the real "connect" story, a later milestone),
sharing scenarios in the URL (deferred: long URLs, privacy of architecture details).

## 2026-10-22 — M7: guide first-time visitors
Context: on its public page the app opened straight onto the full dashboard; a first-time visitor
could not tell what Fragor does or how to use it. Decision: a welcome screen on the first visit
(what Fragor is in one sentence, three steps: describe, break something, watch and compare; two ways
to start: a guided example or the quick form), remembered in `localStorage` and reopened with *How
it works*; an eight-step guided tour over example 01, written in our own small component (a
spotlight, a card, keyboard: arrows and Escape) that moves the replay to the start or to the first
trouble at 1x speed; plain-language "?" tips on every section, number and resilience setting
(`lib/guide.ts` holds every text, shared by the three); and less on screen at once: the detailed
charts and the before/after table are folded under *More detail*. No new dependency. Alternatives:
a tour library (react-joyride and similar: a dependency for a few hundred lines), a separate
landing page (one more page to keep in sync; the welcome sits on top of a live example instead),
a video (cannot be interacted with, goes stale).
