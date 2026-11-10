import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

import { parseModelMetadataSources } from "./model-metadata";
import { listCanonicalPrismaSchemaFiles } from "./schema-source";
import { DEFAULT_SENSITIVITY, TABLE_CLASSIFICATION, getTableSensitivity } from "./table-classification";

const declared = parseModelMetadataSources(
  listCanonicalPrismaSchemaFiles().map((file) => ({ file: basename(file), source: readFileSync(file, "utf8") })),
);
const tagged = declared.entries.filter((e) => e.metadata.sensitivity);

describe("table sensitivity — schema tag first (EP-A33A5C61 slice 4d-ii)", () => {
  it("a tagged model's sensitivity is answered from the schema, by model name and by physical table", () => {
    expect(tagged.length).toBeGreaterThan(100);
    for (const e of tagged) {
      expect(getTableSensitivity(e.model)).toBe(e.metadata.sensitivity);
      expect(getTableSensitivity(e.table)).toBe(e.metadata.sensitivity);
    }
  });

  it("the registry holds no model the schema already declares — the two can never disagree", () => {
    const overlap = tagged.map((e) => e.model).filter((m) => m in TABLE_CLASSIFICATION);
    expect(overlap).toEqual([]);
  });

  it("an untagged model still falls back to the registry, then to the default", () => {
    const untaggedListed = Object.keys(TABLE_CLASSIFICATION).find((m) => !declared.entries.some((e) => e.model === m));
    expect(untaggedListed, "registry should still carry at least one untagged model").toBeDefined();
    expect(getTableSensitivity(untaggedListed!)).toBe(TABLE_CLASSIFICATION[untaggedListed!]);
    expect(getTableSensitivity("NoSuchTableAnywhere")).toBe(DEFAULT_SENSITIVITY);
  });
});
