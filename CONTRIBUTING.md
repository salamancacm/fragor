# Contributing to Fragor

Thanks for your interest. Fragor is a small personal project, so a short discussion before a large change saves
everyone time: open an issue first. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need [pnpm](https://pnpm.io). Node 24 is pinned for the project and pnpm downloads it on install.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm web:dev    # http://localhost:3000
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the packages; [docs/USAGE.md](docs/USAGE.md) shows how the tool
is used.

## Rules of the project

- **Tests first.** A new engine rule or a bug fix starts with a failing test.
- **Determinism.** Simulation code never uses `Math.random`, `Date.now` or `performance.now`; everything goes through
  the seeded random generator.
- **No invented data.** Results are always computed by the engine. If something is not implemented, fail explicitly
  (`throw new Error("not implemented: ...")`).
- **Fault-tolerance semantics must be verified.** Anything described as equivalent to MicroProfile Fault Tolerance,
  SmallRye or Quarkus behavior needs a link to the official documentation in [docs/SEMANTICS.md](docs/SEMANTICS.md)
  and a test, or it is marked `UNVERIFIED`.
- **Strict TypeScript, no `any`.** Use `unknown` and narrow. Keep functions small and files under about 300 lines.
- **Dependencies and decisions.** A new dependency needs a justification in [docs/DECISIONS.md](docs/DECISIONS.md),
  and so does any non-trivial design decision.

## Pull requests

1. Fork, branch from `main`, and keep the change focused.
2. Run `pnpm lint`, `pnpm typecheck` and `pnpm test` (and `pnpm bench` if you touched the engine); all must pass.
3. Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
   Keep commits small and atomic.
4. Update the documentation your change affects.
5. Fill in the pull request template.

## Reporting bugs and proposing ideas

Use the issue templates. For a bug, a scenario file and its seed make it reproducible: the same input always gives the
same result. Security problems go through the [security policy](SECURITY.md), not a public issue.

## License

Contributions are licensed under the [Apache License 2.0](LICENSE), like the rest of the project.
