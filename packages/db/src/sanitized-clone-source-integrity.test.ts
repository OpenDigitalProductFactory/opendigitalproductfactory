import { describe, expect, it } from "vitest";

import {
  assertSanitizedCloneSourceIntegrity,
  SANITIZED_CLONE_SOURCE_INDEX_CONTRACTS,
} from "./sanitized-clone-source-integrity";

class SourceFixture {
  duplicateGroups = 0;
  unhealthyIndex: string | null = null;
  readonly queries: string[] = [];

  async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
    this.queries.push(query);

    if (query.includes("FROM pg_extension")) {
      return [{ installed: true }] as T;
    }
    if (query.includes("FROM pg_index")) {
      const table = String(values[1]);
      const index = table === "InventoryEntity"
        ? "InventoryEntity_entityKey_key"
        : "PlatformIssueReport_dedupeKey_open_key";
      return [{
        table_name: table,
        index_name: index,
        is_unique: true,
        is_valid: this.unhealthyIndex !== index,
        is_ready: true,
        is_live: true,
      }] as T;
    }
    if (query.includes("bt_index_parent_check")) {
      return [] as T;
    }
    if (query.includes("TABLESAMPLE SYSTEM (100)")) {
      return [{ duplicateGroups: this.duplicateGroups }] as T;
    }
    throw new Error(`Unexpected source-integrity query: ${query}`);
  }
}

describe("sanitized clone source integrity", () => {
  it("defines one closed registry for both critical source identities", () => {
    expect(SANITIZED_CLONE_SOURCE_INDEX_CONTRACTS).toEqual([
      {
        table: "InventoryEntity",
        requiredIndexes: [
          { name: "InventoryEntity_entityKey_key", unique: true },
        ],
      },
      {
        table: "PlatformIssueReport",
        requiredIndexes: [
          { name: "PlatformIssueReport_dedupeKey_open_key", unique: true },
        ],
      },
    ]);
  });

  it("accepts physically and semantically healthy source contracts", async () => {
    const source = new SourceFixture();

    await expect(assertSanitizedCloneSourceIntegrity(source)).resolves.toBeUndefined();

    expect(source.queries.some((query) => query.includes("TABLESAMPLE SYSTEM (100)")))
      .toBe(true);
  });

  it("names a physically unhealthy PlatformIssueReport index", async () => {
    const source = new SourceFixture();
    source.unhealthyIndex = "PlatformIssueReport_dedupeKey_open_key";

    await expect(assertSanitizedCloneSourceIntegrity(source)).rejects.toThrow(
      /PlatformIssueReport.*PlatformIssueReport_dedupeKey_open_key.*unhealthy/s,
    );
  });

  it("rejects active heap duplicates even when index metadata is healthy", async () => {
    const source = new SourceFixture();
    source.duplicateGroups = 2;

    await expect(assertSanitizedCloneSourceIntegrity(source)).rejects.toThrow(
      /PlatformIssueReport_dedupeKey_open_key.*2 active dedupeKey group/s,
    );
  });
});
