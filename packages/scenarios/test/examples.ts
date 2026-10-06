import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const EXAMPLES_DIR = join(import.meta.dirname, "..", "examples");

export const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

/** Raw (unvalidated) JSON of an example. */
export function rawExample(file: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}
