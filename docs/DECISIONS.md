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
