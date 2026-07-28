import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs runtime module, no type declarations by design
import {
  checkCollationStability,
  checkIndexIntegrity,
} from "./index-integrity-core.mjs";

/**
 * Stub client returning canned rows for the two queries checkCollationStability
 * issues, in order: the pg_database row, then the pg_collation census.
 */
function stubClient(databaseRow: Record<string, unknown>, libcCount: number) {
  const responses = [
    { rows: [databaseRow] },
    { rows: [{ collprovider: "c", count: libcCount }, { collprovider: "i", count: 871 }] },
  ];
  let call = 0;
  return { query: async () => responses[call++] };
}

const kinds = (findings: Array<{ kind: string }>) => findings.map((f) => f.kind);
const severityOf = (findings: Array<{ kind: string; severity: string }>, kind: string) =>
  findings.find((f) => f.kind === kind)?.severity;

describe("checkCollationStability", () => {
  it("flags a cluster labelled with a real locale but carrying no libc locale data", async () => {
    // The musl-initdb fingerprint that caused BI-8CCF7F13: en_US.utf8 label,
    // but only C/POSIX/default actually registered.
    const result = await checkCollationStability(
      stubClient(
        {
          datcollate: "en_US.utf8",
          datctype: "en_US.utf8",
          datcollversion: null,
          actual_version: "2.36",
        },
        3,
      ),
    );

    expect(kinds(result.findings)).toContain("collation-provider-mismatch");
    expect(result.libcCount).toBe(3);
  });

  it("treats the provider mismatch as advisory, not a build failure", async () => {
    // It describes how the cluster was initialised and cannot be cleared by any
    // repair, so failing on it would hold CI red forever once the indexes are
    // healthy — and a permanently-red guard is one nobody reads.
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "en_US.utf8", datctype: "en_US.utf8", datcollversion: null, actual_version: "2.36" },
        3,
      ),
    );

    expect(severityOf(result.findings, "collation-provider-mismatch")).toBe("warn");
    expect(severityOf(result.findings, "collation-version-unrecorded")).toBe("warn");
    expect(result.findings.every((f: { severity: string }) => f.severity === "warn")).toBe(true);
  });

  it("fails on a recorded-vs-actual collation version mismatch", async () => {
    // This one IS a regression: the comparator moved under indexes still built
    // for the old one, which is precisely when a REINDEX is required.
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "en_US.utf8", datctype: "en_US.utf8", datcollversion: "2.31", actual_version: "2.36" },
        812,
      ),
    );

    expect(kinds(result.findings)).toContain("collation-version-drift");
    expect(severityOf(result.findings, "collation-version-drift")).toBe("error");
  });

  it("stays silent on a healthy glibc cluster with a matching recorded version", async () => {
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "en_US.utf8", datctype: "en_US.utf8", datcollversion: "2.36", actual_version: "2.36" },
        812,
      ),
    );

    expect(result.findings).toEqual([]);
  });

  it("does not flag a deliberately C-collated cluster as a provider mismatch", async () => {
    // A cluster genuinely initdb'd with --locale=C has few libc collations by
    // design and is immune to comparator drift — the opposite of a problem.
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "C", datctype: "C", datcollversion: "1.0", actual_version: "1.0" },
        3,
      ),
    );

    expect(kinds(result.findings)).not.toContain("collation-provider-mismatch");
  });
});

describe("checkIndexIntegrity", () => {
  it("requires an existing amcheck extension without mutating the source database", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const responses = [
      { rows: [{ installed: true }] },
      {
        rows: [{
          table_name: "InventoryEntity",
          index_name: "InventoryEntity_entityKey_key",
          is_unique: true,
        }],
      },
      { rows: [] },
    ];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return responses.shift() ?? { rows: [] };
      },
    };

    const report = await checkIndexIntegrity(client, {
      amcheckMode: "require",
      schema: "public",
      table: "InventoryEntity",
      uniqueOnly: false,
    });

    expect(report).toMatchObject({
      indexesChecked: 1,
      corrupted: [],
      failed: false,
    });
    expect(queries.some(({ sql }) => /\bCREATE\b/i.test(sql))).toBe(false);
    expect(queries[1]?.params).toEqual([false, "InventoryEntity", "public"]);
    expect(queries[2]?.sql).toContain(
      "public.bt_index_parent_check($1::regclass, true, true)",
    );
    expect(queries[2]?.params).toEqual([
      '"public"."InventoryEntity_entityKey_key"',
    ]);
  });

  it("fails closed when amcheck is not already installed in read-only mode", async () => {
    const client = {
      query: async () => ({ rows: [{ installed: false }] }),
    };

    await expect(checkIndexIntegrity(client, {
      amcheckMode: "require",
      schema: "public",
      table: "InventoryEntity",
    })).rejects.toThrow(
      "amcheck must already be installed before checking a production source",
    );
  });

  it("reports a heap-divergent InventoryEntity index as blocking", async () => {
    const responses = [
      { rows: [{ installed: true }] },
      {
        rows: [{
          table_name: "InventoryEntity",
          index_name: "InventoryEntity_entityKey_key",
          is_unique: true,
        }],
      },
    ];
    const client = {
      query: async () => {
        const response = responses.shift();
        if (response) return response;
        throw new Error("heap tuple (0,42) from table is missing from index");
      },
    };

    const report = await checkIndexIntegrity(client, {
      amcheckMode: "require",
      schema: "public",
      table: "InventoryEntity",
    });

    expect(report.failed).toBe(true);
    expect(report.corrupted).toEqual([
      expect.objectContaining({
        table: "InventoryEntity",
        index: "InventoryEntity_entityKey_key",
        isUnique: true,
        error: expect.stringContaining("missing from index"),
      }),
    ]);
  });
});
