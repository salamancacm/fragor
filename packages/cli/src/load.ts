import type { Scenario } from "@fragor/engine";
import {
  applyPatch,
  type PatchOp,
  parseScenario,
  ScenarioValidationError,
} from "@fragor/scenarios";
import { CliError, EXIT_USAGE, type Io } from "./io";

export interface LoadOptions {
  seed?: string | undefined;
  set?: readonly string[] | undefined;
  unset?: readonly string[] | undefined;
}

/** `path=value`: the value is parsed as JSON when possible (1500, true, {...}), else a string. */
export function parseAssignment(arg: string): PatchOp {
  const eq = arg.indexOf("=");
  if (eq <= 0 || eq === arg.length - 1) {
    throw new CliError(`--set expects path=value, got "${arg}"`, EXIT_USAGE);
  }
  const path = arg.slice(0, eq);
  const raw = arg.slice(eq + 1);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  return { op: "set", path, value };
}

function parseSeed(seed: string): number {
  const n = Number(seed);
  if (!Number.isInteger(n))
    throw new CliError(`--seed must be an integer, got "${seed}"`, EXIT_USAGE);
  return n;
}

/** Reads, validates and patches a scenario file. All problems become CliError(EXIT_USAGE). */
export function loadScenario(io: Io, file: string, opts: LoadOptions = {}): Scenario {
  let text: string;
  try {
    text = io.readFile(file);
  } catch {
    throw new CliError(`cannot read "${file}"`, EXIT_USAGE);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new CliError(`"${file}" is not valid JSON: ${(e as Error).message}`, EXIT_USAGE);
  }
  try {
    const ops: PatchOp[] = [
      ...(opts.set ?? []).map(parseAssignment),
      ...(opts.unset ?? []).map((path): PatchOp => ({ op: "unset", path })),
    ];
    if (opts.seed !== undefined) ops.push({ op: "set", path: "seed", value: parseSeed(opts.seed) });
    const scenario = parseScenario(json);
    return ops.length === 0 ? scenario : applyPatch(scenario, ops);
  } catch (e) {
    if (e instanceof CliError) throw e;
    if (e instanceof ScenarioValidationError) {
      throw new CliError(`${file}: ${e.message}`, EXIT_USAGE);
    }
    throw new CliError(`${file}: ${(e as Error).message}`, EXIT_USAGE);
  }
}
