import { describe, expect, it } from "vitest";

import {
  parseRestaurantTableAttributes,
  serializeRestaurantTableAttributes,
  validateRestaurantTableAttributesInput,
} from "./restaurant-table-attributes";

describe("restaurant table attributes", () => {
  it("parses the closed structural contract and removes duplicate combinations", () => {
    expect(
      parseRestaurantTableAttributes({
        shape: "booth",
        combinationGroup: "main-banquette",
        combinableWith: ["table-4", "table-4", " table-5 "],
      }),
    ).toEqual({
      shape: "booth",
      combinationGroup: "main-banquette",
      combinableWith: ["table-4", "table-5"],
    });
  });

  it("degrades unknown or malformed attributes to a safe default", () => {
    expect(
      parseRestaurantTableAttributes({
        shape: "starburst",
        combinationGroup: 12,
        combinableWith: ["", 42],
      }),
    ).toEqual({
      shape: "round",
      combinationGroup: null,
      combinableWith: [],
    });
    expect(parseRestaurantTableAttributes(null)).toEqual({
      shape: "round",
      combinationGroup: null,
      combinableWith: [],
    });
  });

  it("serializes only the canonical structural fields", () => {
    expect(
      serializeRestaurantTableAttributes({
        shape: "rectangle",
        combinationGroup: null,
        combinableWith: ["table-2"],
      }),
    ).toEqual({
      shape: "rectangle",
      combinableWith: ["table-2"],
    });
  });

  it("rejects unknown write values instead of silently changing operator input", () => {
    expect(
      validateRestaurantTableAttributesInput({
        shape: "starburst",
        combinationGroup: null,
        combinableWith: [],
      }),
    ).toEqual({
      ok: false,
      error: "Choose a supported table shape.",
    });
    expect(
      validateRestaurantTableAttributesInput({
        shape: "round",
        combinationGroup: null,
        combinableWith: ["table-2", 42],
      }),
    ).toEqual({
      ok: false,
      error: "Combined-table references are invalid.",
    });
  });
});
