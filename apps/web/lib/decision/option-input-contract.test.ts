import { describe, it, expect } from "vitest";
import {
  readOptionRecords,
  validateOptionIdentities,
  validateOptionInputs,
} from "./option-input-contract";

describe("option-input-contract — identity (BI-9889566B)", () => {
  it("refuses an option whose identity arrived under the wrong key", () => {
    // The live reproduction: a caller wrote `key` where the schema says `id`.
    const errors = validateOptionIdentities([
      { key: "opt-a", description: "A", features: { reusability: 0.9 } },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("id");
    // The message must name what the caller DID send, or they cannot see the
    // typo — this is the whole difference from a silent zero.
    expect(errors[0].detail).toContain("key");
  });

  it("refuses a blank or whitespace-only id", () => {
    expect(validateOptionIdentities([{ id: "", description: "A" }])).toHaveLength(1);
    expect(validateOptionIdentities([{ id: "   ", description: "A" }])).toHaveLength(1);
  });

  it("refuses duplicate ids and names both positions", () => {
    const errors = validateOptionIdentities([
      { id: "same", description: "A" },
      { id: "same", description: "B" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(1);
    expect(errors[0].detail).toContain("option 0");
  });

  it("refuses a missing description", () => {
    const errors = validateOptionIdentities([{ id: "a" }]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("description");
  });

  it("refuses a non-object entry rather than skipping it", () => {
    expect(validateOptionIdentities(["a", null])).toHaveLength(2);
  });

  it("accepts a well-formed set", () => {
    expect(
      validateOptionIdentities([
        { id: "a", description: "A" },
        { id: "b", description: "B" },
      ]),
    ).toEqual([]);
  });
});

describe("option-input-contract — combined refusal ordering", () => {
  it("reports identity before features: an id-less option cannot be NAMED in a feature error", () => {
    const rejection = validateOptionInputs([
      { key: "a", description: "A", features: { not_a_dimension: 0.5 } },
    ]);
    expect(rejection?.error).toBe("Invalid option identity");
  });

  it("still refuses an unknown feature key once identity is sound (BI-E0151DB2 preserved)", () => {
    const rejection = validateOptionInputs([
      { id: "a", description: "A", features: { not_a_dimension: 0.5 } },
    ]);
    expect(rejection?.error).toBe("Invalid option features");
    expect(rejection?.message).toContain("[a]");
  });

  it("returns null for a well-formed set", () => {
    expect(
      validateOptionInputs([
        { id: "a", description: "A", features: { reusability: 0.8 } },
        { id: "b", description: "B", features: { blast_radius: 0.2 } },
      ]),
    ).toBeNull();
  });
});

describe("option-input-contract — readOptionRecords", () => {
  it("drops non-object entries so both consumers walk the same records in the same order", () => {
    expect(readOptionRecords([{ id: "a" }, null, "x", { id: "b" }])).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
});
