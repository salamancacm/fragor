import { parseArgs } from "node:util";
import { compareResults, simulate } from "@fragor/engine";
import { buildAnalysisDigest, deriveFindings, scenarioJsonSchema } from "@fragor/scenarios";
import { formatComparison, formatRun } from "./format";
import { runImport } from "./import";
import { CliError, EXIT_OK, EXIT_RUNTIME, EXIT_USAGE, type Io } from "./io";
import { loadScenario } from "./load";

export const USAGE = `Usage:
  fragor run <scenario.json> [--seed N] [--set path=value]... [--unset path]... [--json | --digest]
  fragor compare <before.json> <after.json> [--seed N] [--json]
  fragor schema [--out file]
  fragor import traces <traces.jsonl> [--from ISO] [--to ISO] [--name N] [--out scenario.json]
                [--metrics service=[before.prom,]after.prom]... [--report report.md]
                [--observed observed.json] [--set path=value]... [--unset path]...
  fragor import observed <observed.json> [--out scenario.json] [--report report.md] [--set ...]

  --set path=value  edit the scenario before running; items of nodes, edges, traffic and faults
                    are addressed by id, e.g. --set edges.order-payment.policies.timeout.valueMs=1500
                    (the value is parsed as JSON when possible)
  --unset path      remove an optional field, e.g. --unset edges.order-payment.policies.retry
  --seed N          override the scenario seed
  --json            print the machine-readable result (run: SimulationResult; compare: comparison)
  --digest          print the analysis digest (summary, timeline, per-node/edge stats, findings)
  --out file        write the JSON Schema (schema) or the draft scenario (import) to a file
  import traces     read OpenTelemetry traces (OTLP JSON lines, as the Collector's file exporter
                    writes them) and build a draft scenario of the system they show, with a report of
                    where every number came from and what is still a placeholder. --from/--to limit
                    it to requests that started in that time range (use a calm one: response times
                    include time waiting for a worker); --set answers the open questions
  --metrics s=files add what a service's own Prometheus metrics (/q/metrics) say: its traffic and
                    whether its calls have a circuit breaker or fallback. Two snapshots of the
                    same instance (before, after) give the rates of that period; one gives the
                    average since the service started. Repeat it for each service

Results come from a deterministic simulation of your assumptions; they are not predictions.
`;

const OPTIONS = {
  seed: { type: "string" },
  set: { type: "string", multiple: true },
  unset: { type: "string", multiple: true },
  json: { type: "boolean" },
  digest: { type: "boolean" },
  out: { type: "string" },
  name: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  report: { type: "string" },
  observed: { type: "string" },
  metrics: { type: "string", multiple: true },
  help: { type: "boolean", short: "h" },
} as const;

/** Runs the CLI; returns the process exit code. Never calls process.exit itself. */
export function main(argv: readonly string[], io: Io): number {
  try {
    return dispatch(argv, io);
  } catch (e) {
    if (e instanceof CliError) {
      io.stderr(`fragor: ${e.message}\n`);
      if (e.exitCode === EXIT_USAGE && e.message.startsWith("usage")) io.stderr(USAGE);
      return e.exitCode;
    }
    io.stderr(`fragor: unexpected error: ${(e as Error).stack ?? String(e)}\n`);
    return EXIT_RUNTIME;
  }
}

function dispatch(argv: readonly string[], io: Io): number {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    throw new CliError(`usage: ${(e as Error).message}`, EXIT_USAGE);
  }
  const { values, positionals } = parsed;
  const [command, ...files] = positionals;
  if (values.help === true || command === undefined) {
    io.stdout(USAGE);
    return command === undefined && values.help !== true ? EXIT_USAGE : EXIT_OK;
  }
  const load = { seed: values.seed, set: values.set, unset: values.unset };
  switch (command) {
    case "run": {
      if (files.length !== 1)
        throw new CliError("usage: run expects exactly one scenario file", EXIT_USAGE);
      if (values.json === true && values.digest === true) {
        throw new CliError("usage: use either --json or --digest", EXIT_USAGE);
      }
      const scenario = loadScenario(io, files[0] as string, load);
      const result = simulate(scenario);
      if (values.json === true) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`);
        return EXIT_OK;
      }
      const findings = deriveFindings(scenario, result);
      io.stdout(
        values.digest === true
          ? `${JSON.stringify(buildAnalysisDigest(scenario, result, findings), null, 2)}\n`
          : formatRun(scenario, result, findings),
      );
      return EXIT_OK;
    }
    case "compare": {
      if (files.length !== 2)
        throw new CliError("usage: compare expects two scenario files", EXIT_USAGE);
      const [a, b] = files as [string, string];
      const before = simulate(loadScenario(io, a, load));
      const after = simulate(loadScenario(io, b, load));
      const comparison = compareResults(before, after);
      io.stdout(
        values.json === true
          ? `${JSON.stringify(comparison, null, 2)}\n`
          : formatComparison(comparison, [a, b]),
      );
      return EXIT_OK;
    }
    case "schema": {
      const text = `${JSON.stringify(scenarioJsonSchema(), null, 2)}\n`;
      if (values.out === undefined) io.stdout(text);
      else {
        try {
          io.writeFile(values.out, text);
        } catch (e) {
          throw new CliError(`cannot write "${values.out}": ${(e as Error).message}`, EXIT_RUNTIME);
        }
      }
      return EXIT_OK;
    }
    case "import": {
      const [kind, ...rest] = files;
      return runImport(io, { kind, files: rest, ...values, ...load });
    }
    default:
      throw new CliError(`usage: unknown command "${command}"`, EXIT_USAGE);
  }
}
