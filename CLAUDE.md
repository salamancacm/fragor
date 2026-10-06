# Fragor — working rules

Fragor is a personal project. Use only "Fragor" as the brand; do not mention any company or
brand in README, package.json, licenses or metadata.

## Rules

1. **Language:** with the author, Spanish. Code, comments, docs and commits, English.
2. **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), small and atomic,
   only with green tests. NEVER include `Co-Authored-By: Claude` (or any other AI co-authorship
   trailer) nor texts like "Generated with Claude Code" in commit or PR messages. Automatic
   attribution is disabled in `.claude/settings.json` (`attribution` with empty `commit` and `pr`).
   Do not `git push` or create remote repositories without asking.
3. **No mocks, no invented data:** results are always computed by the engine. No stubs returning
   fixed numbers, no "TODO: implement later" disguised as a feature. If something is not
   implemented, fail explicitly (`throw new Error("not implemented: ...")`) and note it in the plan.
4. **Do not invent semantics:** anything claimed to be equivalent to MicroProfile Fault Tolerance /
   SmallRye / Quarkus must be verified in the official documentation, cited with a URL in
   `docs/SEMANTICS.md` and covered by a test. If it cannot be verified, mark it `UNVERIFIED`.
5. **Plan before code:** at the start of each milestone write a short plan (<= 15 lines) with
   assumptions. Ask only what blocks progress, in a single batch of at most 3 questions.
6. **Tests first** for engine rules and for any bug (failing test, then fix).
7. **Determinism is sacred:** no `Math.random` / `Date.now` / `performance.now` in simulation
   logic; everything goes through the seeded RNG.
8. **Quality:** strict TS without `any` (use `unknown` and narrow); small functions; files < 300
   lines when reasonable; no new dependencies without justifying them in `docs/DECISIONS.md`.
9. **Living docs:** every non-trivial decision goes in `docs/DECISIONS.md` (date, context,
   decision, alternatives).
10. **AI-ready design (section 10.1 of the brief):** pure versioned JSON, stable IDs, referenceable
    evidence, typed patches, engine with no global state and no network. Do not build AI features
    until the author asks.
11. **Closing a milestone:** show what was done, commands run with summarized output (lint,
    typecheck, tests, bench), decisions taken, pending assumptions and a proposal for the next step.
    Then stop and wait for approval.

## Commands

```bash
pnpm install
pnpm lint        # biome ci
pnpm typecheck
pnpm test
pnpm bench
```
