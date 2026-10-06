import { describe, expect, it } from "vitest";
import { ENGINE_NAME } from "../src/index";

describe("workspace", () => {
  it("resolves the engine entry point", () => {
    expect(ENGINE_NAME).toBe("@fragor/engine");
  });
});
