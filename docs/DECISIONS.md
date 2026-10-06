# Decisions

Short ADR log. Newest at the bottom. Format: date, context, decision, alternatives.

## Tool versions (installed with `pnpm add`, 2026-10-06)

| Tool | Version | Why |
| --- | --- | --- |
| Node (local) | v22.19.0 | `.nvmrc` = 22, `engines.node` >= 22 |
| pnpm | 10.18.3 | workspaces |
| typescript | ^7.0.2 | strict typing (engine runs in browser and Node) |
| @biomejs/biome | ^2.5.15 | single lint + format tool |
| vitest | ^5.0.3 | tests and benchmarks |
| fast-check | ^4.10.2 | property-based tests of engine invariants |
| @types/node | ^22 | matches the Node 22 runtime; used only by tooling, not by the engine |

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
typecheck run without compiling. A build/bundling step will be added when the web app needs it.
The root `build` script is therefore a no-op until a package defines one.

## 2026-10-06 — Node version
Decision: `.nvmrc` pinned to 22, the version verified locally. Newer LTS lines may be adopted
later; CI reads `.nvmrc`. Open question for the author: move to the newest LTS?

## 2026-10-06 — Commit attribution disabled
Decision: `.claude/settings.json` sets `attribution.commit` and `attribution.pr` to empty strings
and `sessionUrl` to false. Confirmed in the official settings reference
(https://code.claude.com/docs/en/settings-reference.md#attribution): `attribution` replaces the
deprecated `includeCoAuthoredBy`; empty strings work on every version, while `attribution: false`
requires v2.1.281+.

## 2026-10-06 — License
Decision: `"license": "UNLICENSED"` and `"private": true`. **The license is pending the author's
decision.**
