import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationsUrl = new URL("../prisma/migrations/", import.meta.url);
const indexQuarantine =
  "20260728115800_quarantine_damaged_inventory_unique_index";
const snapshot = "20260728115900_snapshot_inventory_observation_facts";
const formerRepair = "20260728120000_repair_inventory_entity_index_integrity";
const currentRepair = "20260728130000_repair_inventory_entity_index_integrity";

async function migrationChecksum(name: string): Promise<string> {
  const bytes = await readFile(new URL(`${name}/migration.sql`, migrationsUrl));
  return createHash("sha256").update(bytes).digest("hex");
}

describe("inventory repair migration history", () => {
  it("quarantines a damaged index before snapshotting observation facts", async () => {
    const names = (await readdir(migrationsUrl)).sort();

    expect(names).toContain(indexQuarantine);
    expect(names.indexOf(indexQuarantine)).toBeLessThan(names.indexOf(snapshot));
    expect(names.indexOf(snapshot)).toBeLessThan(names.indexOf(formerRepair));
    expect(names.indexOf(formerRepair)).toBeLessThan(names.indexOf(currentRepair));
  });

  it("preserves the failed snapshot and both repair identities at known checksums", async () => {
    await expect(migrationChecksum(snapshot)).resolves.toBe(
      "e443357fe93a2f99ada9be0b614663e6d0885b95523a9b4d572353a657b5a77f",
    );
    await expect(migrationChecksum(indexQuarantine)).resolves.toBe(
      "132be99f149869db31d0266f5dfe6cb7f9923f157dbf8f567bf67ebc00f116b7",
    );
    await expect(migrationChecksum(formerRepair)).resolves.toBe(
      "84704a50ad127a0a4823074956f8041cd99f647accbcb39ce17c856fa1f13d90",
    );
    await expect(migrationChecksum(currentRepair)).resolves.toBe(
      "49751a531c643b41d169a305c51f0d2a2ece9c44b8861138d3d894cdc3a7921b",
    );
  });
});
