import { describe, it, expect } from "vitest";
import { validateLinkValue, isReferenceValue } from "./cell-links";
import type { LinkConfig } from "./types";

const many: LinkConfig = { cardinality: "many", referenceType: "epic" };
const one: LinkConfig = { cardinality: "one", referenceType: "epic" };

describe("isReferenceValue", () => {
  it("accepts a reference object, rejects arrays/strings/null", () => {
    expect(isReferenceValue({ referenceId: "E1", referenceType: "epic" })).toBe(true);
    expect(isReferenceValue([{ referenceId: "E1" }])).toBe(false);
    expect(isReferenceValue("E1")).toBe(false);
    expect(isReferenceValue(null)).toBe(false);
  });
});

describe("validateLinkValue", () => {
  it("normalizes a list of references and fills referenceType from config", () => {
    const out = validateLinkValue(
      [{ referenceId: "E1", referenceType: "epic" }, { referenceId: "E2" } as never],
      many,
    );
    expect(out).toEqual([
      { referenceId: "E1", referenceType: "epic" },
      { referenceId: "E2", referenceType: "epic" },
    ]);
  });

  it("treats null/empty as no links", () => {
    expect(validateLinkValue(null, many)).toEqual([]);
    expect(validateLinkValue([], many)).toEqual([]);
  });

  it("de-duplicates repeated targets within a cell", () => {
    const out = validateLinkValue(
      [
        { referenceId: "E1", referenceType: "epic" },
        { referenceId: "E1", referenceType: "epic" },
      ],
      many,
    );
    expect(out).toEqual([{ referenceId: "E1", referenceType: "epic" }]);
  });

  it("rejects a wrong target type (fail-closed)", () => {
    expect(() =>
      validateLinkValue([{ referenceId: "C1", referenceType: "customer_account" }], many),
    ).toThrow(/links to epic/i);
  });

  it("rejects a non-list value", () => {
    expect(() => validateLinkValue("E1" as never, many)).toThrow(/list of records/i);
  });

  it("rejects a malformed item", () => {
    expect(() => validateLinkValue([{ foo: "bar" } as never], many)).toThrow(/referenceId/i);
  });

  it("enforces cardinality 'one' (at most a single link)", () => {
    expect(
      validateLinkValue([{ referenceId: "E1", referenceType: "epic" }], one),
    ).toHaveLength(1);
    expect(() =>
      validateLinkValue(
        [
          { referenceId: "E1", referenceType: "epic" },
          { referenceId: "E2", referenceType: "epic" },
        ],
        one,
      ),
    ).toThrow(/only one/i);
  });

  it("throws when config is missing", () => {
    expect(() => validateLinkValue([{ referenceId: "E1", referenceType: "epic" }], undefined)).toThrow(
      /configuration/i,
    );
  });
});
