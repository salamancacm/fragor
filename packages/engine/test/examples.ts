import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "../src";

const DIR = join(import.meta.dirname, "..", "..", "scenarios", "examples");

/** Loads a canonical scenario. Schema validation (Zod) arrives in M3; the engine validates structure. */
export function example(file: string): Scenario {
  return JSON.parse(readFileSync(join(DIR, file), "utf8")) as Scenario;
}
