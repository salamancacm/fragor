import {
  applyMetrics,
  buildScenario,
  type ObservedSystem,
  observeTraces,
  parseObserved,
  parseOtlp,
  parseProm,
  renderReport,
  type ServiceInput,
  summarizeMetrics,
} from "@fragor/importers";
import type { PatchOp } from "@fragor/scenarios";
import { CliError, EXIT_OK, EXIT_RUNTIME, EXIT_USAGE, type Io } from "./io";
import { parseAssignment } from "./load";

export interface ImportArgs {
  /** `traces` or `observed`. */
  kind: string | undefined;
  files: readonly string[];
  name?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Where to write the draft scenario. */
  out?: string | undefined;
  /** Where to write the report (stdout by default). */
  report?: string | undefined;
  /** Where to write the observed system the scenario was built from. */
  observed?: string | undefined;
  /** `service=after.prom` or `service=before.prom,after.prom`: the metrics of a service. */
  metrics?: readonly string[] | undefined;
  set?: readonly string[] | undefined;
  unset?: readonly string[] | undefined;
}

function readText(io: Io, file: string): string {
  try {
    return io.readFile(file);
  } catch {
    throw new CliError(`cannot read "${file}"`, EXIT_USAGE);
  }
}

function write(io: Io, file: string, text: string): void {
  try {
    io.writeFile(file, text);
  } catch (e) {
    throw new CliError(`cannot write "${file}": ${(e as Error).message}`, EXIT_RUNTIME);
  }
}

function instant(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms))
    throw new CliError(`${flag} must be a date and time, got "${value}"`, EXIT_USAGE);
  return ms;
}

/** The observed system a file or a set of traces describes, with the reader's notes. */
function observe(io: Io, a: ImportArgs): { observed: ObservedSystem; warnings: string[] } {
  const file = a.files[0] as string;
  const text = readText(io, file);
  if (a.kind === "observed") {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new CliError(`"${file}" is not valid JSON: ${(e as Error).message}`, EXIT_USAGE);
    }
    const r = parseObserved(json);
    if (!r.ok) throw new CliError(`${file}:\n  - ${r.errors.join("\n  - ")}`, EXIT_USAGE);
    return { observed: r.observed, warnings: [] };
  }
  const parsed = parseOtlp(text);
  if (parsed.spans.length === 0)
    throw new CliError(
      `${file}: no spans found. ${parsed.problems.slice(0, 3).join(" ")}`,
      EXIT_USAGE,
    );
  const fromMs = instant("--from", a.from);
  const toMs = instant("--to", a.to);
  const r = observeTraces(parsed.spans, {
    source: `OpenTelemetry traces: ${file}`,
    ...(a.name === undefined ? {} : { name: a.name }),
    ...(fromMs === undefined ? {} : { fromMs }),
    ...(toMs === undefined ? {} : { toMs }),
  });
  if (!r.ok) throw new CliError(`${file}: ${r.errors.join(" ")}`, EXIT_USAGE);
  const unread =
    parsed.problems.length > 0
      ? [`${parsed.problems.length} lines of the file could not be read.`]
      : [];
  return { observed: r.observed, warnings: [...unread, ...r.warnings] };
}

/** The metrics of one service from `service=after.prom` or `service=before.prom,after.prom`. */
function readMetrics(io: Io, spec: string): ServiceInput {
  const eq = spec.indexOf("=");
  const service = spec.slice(0, eq);
  const files = eq < 0 ? [] : spec.slice(eq + 1).split(",");
  if (service === "" || files.length < 1 || files.length > 2 || files.some((f) => f === ""))
    throw new CliError(
      `--metrics expects service=after.prom or service=before.prom,after.prom, got "${spec}"`,
      EXIT_USAGE,
    );
  const [before, after] = files.length === 2 ? files : [undefined, files[0]];
  const read = (file: string) => {
    const parsed = parseProm(readText(io, file));
    if (parsed.samples.length === 0)
      throw new CliError(`${file}: no metrics found. ${parsed.problems[0] ?? ""}`, EXIT_USAGE);
    return parsed.samples;
  };
  const r = summarizeMetrics(read(after as string), before === undefined ? null : read(before));
  if (!r.ok) throw new CliError(`${service}: ${r.error}`, EXIT_USAGE);
  return { service, metrics: r.metrics };
}

/** `fragor import traces|observed <file>`: a draft scenario and a report of where every number came from. */
export function runImport(io: Io, a: ImportArgs): number {
  if ((a.kind !== "traces" && a.kind !== "observed") || a.files.length !== 1)
    throw new CliError("usage: import expects `traces <file>` or `observed <file>`", EXIT_USAGE);
  const seen = observe(io, a);
  const enriched = applyMetrics(
    seen.observed,
    (a.metrics ?? []).map((m) => readMetrics(io, m)),
  );
  const observed = enriched.observed;
  const warnings = [...seen.warnings, ...enriched.warnings];
  const answers: PatchOp[] = [
    ...(a.set ?? []).map(parseAssignment),
    ...(a.unset ?? []).map((path): PatchOp => ({ op: "unset", path })),
  ];
  const built = buildScenario(observed, { answers, warnings });
  if (!built.ok)
    throw new CliError(`cannot build a scenario:\n  - ${built.errors.join("\n  - ")}`, EXIT_USAGE);

  const report = renderReport(built.report);
  if (a.observed !== undefined) write(io, a.observed, `${JSON.stringify(observed, null, 2)}\n`);
  if (a.out !== undefined) write(io, a.out, `${JSON.stringify(built.scenario, null, 2)}\n`);
  if (a.report === undefined) io.stdout(report);
  else {
    write(io, a.report, report);
    io.stdout(`Report written to ${a.report}.\n`);
  }
  const { counts, questions } = built.report;
  io.stdout(
    `\n${a.out === undefined ? "Add --out draft.json to write the scenario." : `Scenario written to ${a.out}: run it with \`fragor run ${a.out}\`.`} ` +
      `${counts.assumed} parameters are placeholders and ${questions.length} questions are open: answer them with --set path=value.\n`,
  );
  return EXIT_OK;
}
