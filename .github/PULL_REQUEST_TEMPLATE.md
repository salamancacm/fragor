## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## How it was checked

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm bench` (only if the engine changed)

## Checklist

- [ ] A failing test came first (engine rules and bug fixes)
- [ ] Simulation code uses only the seeded random generator
- [ ] Claims of equivalence with MicroProfile Fault Tolerance / SmallRye / Quarkus are cited in `docs/SEMANTICS.md` and tested, or marked `UNVERIFIED`
- [ ] New dependencies and design decisions are recorded in `docs/DECISIONS.md`
- [ ] Documentation updated
- [ ] Commits follow Conventional Commits
