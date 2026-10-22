import { z } from "zod";
import { observedSystemSchema } from "./observed";

export const OBSERVED_SCHEMA_ID = "urn:fragor:schema:observed-system:v1";

/**
 * JSON Schema (draft 2020-12) of an observed system, generated from the Zod schema. Duplicate ids
 * and references to missing services cannot be expressed in JSON Schema; they are listed in the
 * description and enforced by parseObserved.
 */
export function observedJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(observedSystemSchema, { target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
  return {
    ...schema,
    $id: OBSERVED_SCHEMA_ID,
    title: "Fragor observed system",
    description: `${String(schema.description ?? "")} Also required (checked by Fragor, not by JSON Schema): ids are unique per collection; calls start and end at listed services; traffic targets a listed service; p99Ms >= p50Ms.`,
  };
}
