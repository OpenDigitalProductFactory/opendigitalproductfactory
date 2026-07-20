import { describe, it, expect } from "vitest";
import {
  buildDestinationResetSql,
  buildPgDumpArgs,
  buildPsqlEnvironment,
  buildPsqlArgs,
  buildSanitizedSelectList,
  assertDistinctDatabaseIdentities,
  obfuscateName,
  obfuscateEmail,
  obfuscatePhone,
  obfuscateField,
  shouldCopyTable,
  shouldObfuscateTable,
  shouldSkipTable,
  prepareInsertParameter,
  runWithDestinationCleanup,
  insertRowsWithReplicationDisabled,
} from "./sanitized-clone";

describe("obfuscation", () => {
  it("generates deterministic dev names from input", () => {
    const name1 = obfuscateName("Jane Smith", 1);
    const name2 = obfuscateName("Jane Smith", 1);
    expect(name1).toBe(name2);
    expect(name1).toBe("Dev User 001");
  });

  it("generates unique names for different indices", () => {
    expect(obfuscateName("Alice", 1)).not.toBe(obfuscateName("Bob", 2));
  });

  it("obfuscates email deterministically", () => {
    const email = obfuscateEmail("jane@example.com", 1);
    expect(email).toBe("dev001@dpf.test");
  });

  it("obfuscates phone", () => {
    const phone = obfuscatePhone("+1-555-123-4567", 1);
    expect(phone).toBe("555-0001");
  });

  it("handles null/undefined fields", () => {
    expect(obfuscateField(null, "name", 1)).toBeNull();
    expect(obfuscateField(undefined, "name", 1)).toBeUndefined();
  });
});

describe("insert parameter preparation", () => {
  it("serializes arrays for jsonb columns instead of casting them as text arrays", () => {
    const result = prepareInsertParameter(["read", "write"], { dataType: "jsonb", udtName: "jsonb" }, 1);

    expect(result).toEqual({
      placeholder: "$1::jsonb",
      value: "[\"read\",\"write\"]",
    });
  });

  it("keeps non-json array columns as PostgreSQL array literals", () => {
    const result = prepareInsertParameter(["a", "b"], { dataType: "ARRAY", udtName: "_text" }, 2);

    expect(result).toEqual({
      placeholder: "$2::text[]",
      value: "{\"a\",\"b\"}",
    });
  });

  it("keeps decimal-like values out of the jsonb fallback for numeric columns", () => {
    const decimalLike = {
      toString: () => "12.34",
    };

    const result = prepareInsertParameter(decimalLike, { dataType: "numeric", udtName: "numeric" }, 3);

    expect(result).toEqual({
      placeholder: "$3",
      value: "12.34",
    });
  });
});

describe("native PostgreSQL column projection", () => {
  it("omits source-derived tsvector and vector content while retaining ordinary columns", () => {
    const columns = new Map([
      ["id", { dataType: "text", udtName: "text" }],
      ["searchVector", { dataType: "USER-DEFINED", udtName: "tsvector" }],
      ["embedding", { dataType: "USER-DEFINED", udtName: "vector" }],
      ["displayName", { dataType: "text", udtName: "text" }],
    ]);

    expect(buildSanitizedSelectList(columns)).toBe(
      '"id", NULL::text AS "searchVector", NULL::text AS "embedding", "displayName"',
    );
  });

  it("quotes catalog identifiers instead of treating them as SQL syntax", () => {
    const columns = new Map([
      ['search"Vector', { dataType: "USER-DEFINED", udtName: "tsvector" }],
    ]);

    expect(buildSanitizedSelectList(columns)).toBe(
      'NULL::text AS "search""Vector"',
    );
  });
});

describe("destination cleanup", () => {
  it("refuses to clear a destination that resolves to the production database", () => {
    const identity = { databaseName: "dpf", serverAddress: "127.0.0.1", serverPort: 5432 };
    expect(() => assertDistinctDatabaseIdentities(identity, identity)).toThrow(
      "PRODUCTION_DATABASE_URL and DATABASE_URL resolve to the same PostgreSQL database",
    );
  });

  it("allows source and destination databases on the same server when their database names differ", () => {
    expect(() => assertDistinctDatabaseIdentities(
      { databaseName: "dpf", serverAddress: "127.0.0.1", serverPort: 5432 },
      { databaseName: "dpf_dev", serverAddress: "127.0.0.1", serverPort: 5432 },
    )).not.toThrow();
  });

  it("clears every application table together while preserving Prisma migration history", () => {
    expect(buildDestinationResetSql(["User", "Organization", "_prisma_migrations"])).toBe(
      'TRUNCATE TABLE "User", "Organization" RESTART IDENTITY CASCADE',
    );
  });

  it("escapes table identifiers in the reset statement", () => {
    expect(buildDestinationResetSql(['odd"table'])).toBe(
      'TRUNCATE TABLE "odd""table" RESTART IDENTITY CASCADE',
    );
  });

  it("resets before a successful clone", async () => {
    const events: string[] = [];

    await runWithDestinationCleanup(
      async () => { events.push("reset"); },
      async () => { events.push("clone"); },
    );

    expect(events).toEqual(["reset", "clone"]);
  });

  it("resets again before exposing a failed clone", async () => {
    const events: string[] = [];

    await expect(runWithDestinationCleanup(
      async () => { events.push("reset"); },
      async () => {
        events.push("clone");
        throw new Error("native column failed");
      },
    )).rejects.toThrow("native column failed");

    expect(events).toEqual(["reset", "clone", "reset"]);
  });

  it("surfaces cleanup failure together with the clone failure", async () => {
    let resetCount = 0;

    await expect(runWithDestinationCleanup(
      async () => {
        resetCount += 1;
        if (resetCount === 2) throw new Error("cleanup failed");
      },
      async () => { throw new Error("clone failed"); },
    )).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: "clone failed" }), expect.objectContaining({ message: "cleanup failed" })],
    });
  });
});

describe("bounded confidential inserts", () => {
  it("uses explicit bounded transactions and disables triggers in every chunk", async () => {
    const events: string[] = [];
    const transactionOptions: Array<{ maxWait?: number; timeout?: number }> = [];
    const transactionClient = {
      $queryRawUnsafe: async () => [
        { columnName: "id", dataType: "text", udtName: "text" },
      ],
      $executeRawUnsafe: async (sql: string) => {
        events.push(sql);
        return 1;
      },
    };
    const client = {
      $transaction: async (
        callback: (transaction: typeof transactionClient) => Promise<void>,
        options: { maxWait?: number; timeout?: number },
      ) => {
        transactionOptions.push(options);
        await callback(transactionClient);
      },
    };

    await insertRowsWithReplicationDisabled(
      client as never,
      "LargeConfidentialTable",
      [{ id: "one" }, { id: "two" }, { id: "three" }],
      { batchSize: 2, maxWaitMs: 10_000, timeoutMs: 30_000 },
    );

    expect(transactionOptions).toEqual([
      { maxWait: 10_000, timeout: 30_000 },
      { maxWait: 10_000, timeout: 30_000 },
    ]);
    expect(events.filter((sql) => sql === "SET LOCAL session_replication_role = replica")).toHaveLength(2);
    expect(events.filter((sql) => sql.startsWith("INSERT INTO"))).toHaveLength(3);
  });
});

describe("verbatim copy command arguments", () => {
  it("passes URLs and table names as arguments rather than shell syntax", () => {
    expect(buildPgDumpArgs("postgresql://source/db?x=1&y=2", 'odd"table')).toEqual([
      "--dbname=postgresql://source/db?x=1&y=2",
      "--data-only",
      '--table=public."odd""table"',
      "--no-owner",
      "--no-privileges",
    ]);
    expect(buildPsqlArgs("postgresql://destination/db?x=1&y=2")).toEqual([
      "--dbname=postgresql://destination/db?x=1&y=2",
      "--set=ON_ERROR_STOP=1",
    ]);
    expect(buildPsqlEnvironment({ PGOPTIONS: "-c statement_timeout=0" })).toMatchObject({
      PGOPTIONS: "-c statement_timeout=0 -c session_replication_role=replica",
    });
  });
});

describe("table classification helpers", () => {
  it("public and internal tables should be copied", () => {
    expect(shouldCopyTable("TaxonomyNode")).toBe(true);
    expect(shouldCopyTable("Portfolio")).toBe(true);
  });

  it("confidential tables should be obfuscated", () => {
    expect(shouldObfuscateTable("User")).toBe(true);
    expect(shouldObfuscateTable("EmployeeProfile")).toBe(true);
  });

  it("restricted tables should be skipped", () => {
    expect(shouldSkipTable("CredentialEntry")).toBe(true);
    expect(shouldSkipTable("ApiToken")).toBe(true);
  });

  it("keeps provider connections with their restricted provider parent", () => {
    expect(shouldSkipTable("ModelProvider")).toBe(true);
    expect(shouldSkipTable("AiProviderConnection")).toBe(true);
  });

  it("does not copy source-derived vector embeddings", () => {
    expect(shouldSkipTable("VectorEmbedding")).toBe(true);
  });

  it("unknown tables default to confidential (obfuscate)", () => {
    expect(shouldObfuscateTable("SomeNewTable")).toBe(true);
    expect(shouldCopyTable("SomeNewTable")).toBe(false);
    expect(shouldSkipTable("SomeNewTable")).toBe(false);
  });
});
