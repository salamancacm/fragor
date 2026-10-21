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

Early development. Milestones M0-M4 are done; next steps are being planned.. The engine (`@fragor/engine`, pure
TypeScript, zero runtime dependencies) is built first; the UI comes later.

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 | Repo, tooling, CI, docs | done |
| M1 | Engine core: heap, RNG, distributions, histogram, single-node service | done |
| M2 | Resilience policies, faults, canonical scenarios | done |
| M3 | Scenario schemas, patches, findings, CLI | done |
| M4 | Minimal web UI | done |

## What the engine models today

- Services and external APIs with workers, bounded FIFO queues (503 load shedding), service
  time distributions, error rates and dependency calls; blocking or async workers.
- Network legs with latency and packet loss.
- Client policies per edge, composed as `Fallback(Retry(CircuitBreaker(Timeout(Bulkhead(...)))))`
  with MicroProfile Fault Tolerance / SmallRye semantics (see [docs/SEMANTICS.md](docs/SEMANTICS.md)).
- Timeouts that leave orphaned work running (or cancel it, if you choose).
- Faults: added latency, error rates, outages, capacity loss, packet loss, traffic surges.
- Per-bucket series, per-traffic outcomes, breaker transitions and sampled traces, all as plain
  versioned JSON with a determinism fingerprint.

Canonical scenarios are described in [docs/SCENARIOS.md](docs/SCENARIOS.md).

## Try it

The full guide is [docs/USAGE.md](docs/USAGE.md). In short:

```bash
pnpm install
pnpm build
node packages/cli/dist/fragor.mjs run packages/scenarios/examples/01-payment-slow-baseline.json
node packages/cli/dist/fragor.mjs compare packages/scenarios/examples/01-payment-slow-baseline.json packages/scenarios/examples/02-payment-slow-with-breaker.json
```

The first command prints the outcome of a slow payment provider behind timeouts and retries,
plus findings such as the cascade of saturated workers. The second shows what a circuit breaker
with a fallback changes. What-if from the command line:
`--set edges.order-payment.policies.timeout.valueMs=1500`.

## Web UI

```bash
pnpm web:dev      # http://localhost:3000
pnpm build        # CLI bundle + static site in apps/web/out
```

Pick a canonical scenario, run it, change timeouts, retries, circuit breakers or traffic, and run
again: every chart and number is compared with the previous run. The simulation runs in a Web Worker
in your browser; the site is static and sends nothing anywhere.

## Real services

`examples/quarkus-demo` has real Quarkus services that mirror scenarios 01/02, a k6 load test and
the mirror Fragor scenarios, to compare the model with reality. See its
[README](examples/quarkus-demo/README.md).

## Development

Requires pnpm. Node 24 is pinned per project: pnpm downloads it on install.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm bench   # performance budget of the engine
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SEMANTICS.md](docs/SEMANTICS.md),
[docs/DECISIONS.md](docs/DECISIONS.md) and [docs/SCENARIOS.md](docs/SCENARIOS.md).

## License

[Apache License 2.0](LICENSE). See also [NOTICE](NOTICE).
