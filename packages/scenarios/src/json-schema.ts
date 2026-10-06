import { z } from "zod";
import { scenarioObjectSchema } from "./schema";

export const SCENARIO_SCHEMA_ID = "urn:fragor:schema:scenario:v1";

/**
 * JSON Schema (draft 2020-12) of a scenario, generated from the Zod schemas. Cross references
 * (ids that must exist, call cycles, maxMs >= minMs, ...) cannot be expressed in JSON Schema;
 * they are listed in the schema description and enforced by parseScenario.
 */
export function scenarioJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(scenarioObjectSchema, { target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
  return {
    ...schema,
    $id: SCENARIO_SCHEMA_ID,
    title: "Fragor scenario",
    description: `${String(schema.description ?? "")} Also required (checked by Fragor, not by JSON Schema): ids are unique per collection; edges, calls, traffic targets and fault targets reference existing ids; a call's edge starts at the calling node; calls form no cycle; uniform maxMs >= minMs; lognormal p99Ms >= p50Ms; with backoffFactor, delayMs < maxDelayMs.`,
  };
}
