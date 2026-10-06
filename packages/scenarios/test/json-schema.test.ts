import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENARIO_SCHEMA_ID, scenarioJsonSchema } from "../src";

const COMMITTED = join(import.meta.dirname, "..", "schema", "scenario.schema.json");

/** Every node of the schema that declares a property or a variant, with its JSON pointer. */
function* nodes(value: unknown, pointer = "#"): Generator<[string, Record<string, unknown>]> {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) yield* nodes(v, `${pointer}/${i}`);
    return;
  }
  const obj = value as Record<string, unknown>;
  yield [pointer, obj];
  for (const [k, v] of Object.entries(obj)) yield* nodes(v, `${pointer}/${k}`);
}

describe("scenario JSON Schema", () => {
  const schema = scenarioJsonSchema();

  it("matches the committed schema file (regenerate with `pnpm build && pnpm schema:update`)", () => {
    expect(readFileSync(COMMITTED, "utf8")).toBe(`${JSON.stringify(schema, null, 2)}\n`);
  });

  it("is a draft 2020-12 schema with a stable id", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(SCENARIO_SCHEMA_ID);
    expect(String(schema.description)).toMatch(/not a prediction/);
  });

  it("documents every property: a reader can write a scenario from the schema alone", () => {
    const undocumented: string[] = [];
    let checked = 0;
    for (const [pointer, node] of nodes(schema)) {
      const props = node.properties;
      if (typeof props !== "object" || props === null) continue;
      for (const [name, prop] of Object.entries(props as Record<string, Record<string, unknown>>)) {
        // The discriminator literal of a variant explains itself through the variant description.
        if (name === "type" && "const" in prop) continue;
        if (name === "op" && "const" in prop) continue;
        checked++;
        const described = typeof prop.description === "string" || "$ref" in prop;
        if (!described) undocumented.push(`${pointer}/properties/${name}`);
      }
    }
    expect(undocumented).toEqual([]);
    expect(checked).toBeGreaterThan(60);
  });

  it("states units in the descriptions of time and rate fields", () => {
    for (const [, node] of nodes(schema)) {
      const props = node.properties as Record<string, Record<string, unknown>> | undefined;
      for (const [name, prop] of Object.entries(props ?? {})) {
        if (/Ms$/.test(name)) expect(String(prop.description), name).toMatch(/milliseconds/);
        if (/Rps$|^rps$/.test(name))
          expect(String(prop.description), name).toMatch(/requests per second/);
      }
    }
  });
});
