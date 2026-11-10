import { describe, expect, it } from "vitest";
import { modelOutputCapacityFields } from "./model-output-capacity";

describe("output capacity storage and ownership", () => {
  it.each([1, 2_000, 128_000, 2_147_483_647])("accepts a reported integer within storage bounds: %s", (limit) => {
    expect(modelOutputCapacityFields(limit)).toEqual({ maxOutputTokens: limit });
  });

  it("does not treat a numeric string as provider evidence", () => {
    expect(modelOutputCapacityFields("128000" as unknown as number)).toEqual({});
  });

  it("keeps a partial admin lock scoped to its field", () => {
    expect(modelOutputCapacityFields(64_000, { profileSource: "admin", capabilityOverrides: { supportsToolUse: false } }))
      .toEqual({ maxOutputTokens: 64_000 });
  });
});
