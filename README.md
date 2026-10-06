# Fragor

> Break your architecture before production does.

*Fragor* (Latin: the crash of something breaking) is a deterministic simulator. You design a
microservice architecture, inject faults and load, and see how resilience policies (timeouts,
retries, circuit breakers, bulkheads, fallbacks) change the outcome. Policy names and parameters
mirror MicroProfile Fault Tolerance / SmallRye so a later export to Quarkus is straightforward.

## Honesty principle

**A simulation is not a prediction.** Results depend on the parameters you assume. The value is in
understanding mechanisms (how a failure propagates, which policy contains it), not in exact
numbers. All numbers shown anywhere in Fragor are computed by the engine from your scenario.

## Status

Early development. Current milestone: **M1 (engine core)**. The engine (`@fragor/engine`, pure
TypeScript, zero runtime dependencies) is built first; the UI comes later.

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 | Repo, tooling, CI, docs | done |
| M1 | Engine core: heap, RNG, distributions, histogram, single-node service | pending |
| M2 | Resilience policies, faults, canonical scenarios | pending |
| M3 | Scenario schemas, patches, findings, CLI | planned |
| M4 | Minimal web UI | planned |

## Development

Requires pnpm. Node 24 is pinned per project: pnpm downloads it on install.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SEMANTICS.md](docs/SEMANTICS.md),
[docs/DECISIONS.md](docs/DECISIONS.md) and [docs/SCENARIOS.md](docs/SCENARIOS.md).

## License

Not yet decided. The package is `private` and `UNLICENSED`.
