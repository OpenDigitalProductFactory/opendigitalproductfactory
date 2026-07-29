import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INVENTORY_ENTITY_MERGE_REFERENCES } from "./inventory-entity-merge-references";

const schemaPath = join(__dirname, "..", "prisma", "schema.prisma");
const migrationPath = join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20260728130000_repair_inventory_entity_index_integrity",
  "migration.sql",
);

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function schemaRelationsTargetingInventoryEntity(): string[] {
  const schema = readFileSync(schemaPath, "utf8");
  const results: string[] = [];
  for (const [, modelName, body] of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    const relations = body!.matchAll(
      /(\w+)\s+InventoryEntity\??\s+@relation\((?:"[^"]*",\s*)?fields:\s*\[(\w+)\]/g,
    );
    for (const [, , field] of relations) {
      results.push(`${lowerFirst(modelName!)}.${field}`);
    }
  }
  return results.sort();
}

describe("InventoryEntity merge reference completeness", () => {
  it("declares every hard schema relation except the tombstone pointer itself", () => {
    const schemaRelations = schemaRelationsTargetingInventoryEntity()
      .filter((reference) => reference !== "inventoryEntity.mergedIntoId");
    const declared = INVENTORY_ENTITY_MERGE_REFERENCES.hard
      .map(({ model, field }) => `${model}.${field}`)
      .sort();

    expect(schemaRelations.length).toBeGreaterThan(0);
    expect(declared).toEqual(schemaRelations);
  });

  it("keeps RemoteAction.inventoryEntityId in the explicit soft-reference registry", () => {
    expect(INVENTORY_ENTITY_MERGE_REFERENCES.soft).toContainEqual({
      model: "remoteAction",
      table: "RemoteAction",
      field: "inventoryEntityId",
    });
  });

  it("mentions every declared hard and soft reference in the fleet repair migration", () => {
    const migration = readFileSync(migrationPath, "utf8");
    for (const reference of [
      ...INVENTORY_ENTITY_MERGE_REFERENCES.hard,
      ...INVENTORY_ENTITY_MERGE_REFERENCES.soft,
    ]) {
      expect(migration, `${reference.table}.${reference.field}`).toContain(
        `"${reference.table}"`,
      );
      expect(migration, `${reference.table}.${reference.field}`).toContain(
        `"${reference.field}"`,
      );
    }
  });
});
