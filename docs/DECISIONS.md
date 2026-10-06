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
