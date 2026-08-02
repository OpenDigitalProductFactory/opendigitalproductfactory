import { describe, it, expect } from "vitest";
import { addColumnSchema } from "./column-schema";

/** Parse a column create and return the (possibly stripped) config. */
function parseConfig(fieldType: string, config: unknown) {
  return addColumnSchema.parse({ name: "Col", fieldType, config }).config;
}

describe("addColumnSchema — number/format config is preserved (not stripped)", () => {
  it("keeps currencySymbol + precision on a currency column", () => {
    expect(parseConfig("currency", { currencySymbol: "€", precision: 2 })).toEqual({
      currencySymbol: "€",
      precision: 2,
    });
  });
  it("keeps precision on a percent column", () => {
    expect(parseConfig("percent", { precision: 1 })).toEqual({ precision: 1 });
  });
  it("keeps durationUnit on a duration column", () => {
    expect(parseConfig("duration", { durationUnit: "seconds" })).toEqual({ durationUnit: "seconds" });
  });
  it("keeps max on a rating column", () => {
    expect(parseConfig("rating", { max: 10 })).toEqual({ max: 10 });
  });
});

describe("addColumnSchema — link/rollup config regression (previously stripped)", () => {
  it("keeps a link column's cardinality + referenceType", () => {
    expect(parseConfig("link", { link: { cardinality: "many", referenceType: "epic" } })).toEqual({
      link: { cardinality: "many", referenceType: "epic" },
    });
  });
  it("keeps a rollup column's linkColumnId + op", () => {
    expect(parseConfig("rollup", { rollup: { linkColumnId: "COL-1", op: "count" } })).toEqual({
      rollup: { linkColumnId: "COL-1", op: "count" },
    });
  });
});

describe("addColumnSchema — validation bounds", () => {
  it("rejects an unknown duration unit", () => {
    expect(() => parseConfig("duration", { durationUnit: "hours" })).toThrow();
  });
  it("rejects precision out of range", () => {
    expect(() => parseConfig("number", { precision: 99 })).toThrow();
  });
  it("rejects a non-integer precision", () => {
    expect(() => parseConfig("number", { precision: 1.5 })).toThrow();
  });
  it("rejects an over-long currency symbol", () => {
    expect(() => parseConfig("currency", { currencySymbol: "toolongsymbol" })).toThrow();
  });
  it("strips genuinely unknown keys", () => {
    // A key in neither the type nor the schema is still dropped.
    expect(parseConfig("number", { precision: 0, bogusKey: 1 })).toEqual({ precision: 0 });
  });
});

describe("addColumnSchema — superRefine still enforces computed-column requirements", () => {
  it("requires a formula for a formula column", () => {
    expect(() => addColumnSchema.parse({ name: "F", fieldType: "formula", config: {} })).toThrow();
  });
  it("requires a target entity for a reference column", () => {
    expect(() => addColumnSchema.parse({ name: "R", fieldType: "reference", config: {} })).toThrow();
  });
  it("accepts a plain text column with no config", () => {
    expect(addColumnSchema.parse({ name: "T", fieldType: "text" }).config).toBeUndefined();
  });
});
