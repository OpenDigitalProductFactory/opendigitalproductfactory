import { describe, it, expect, vi } from "vitest";
import { withSanitizedCursorBatches } from "./sanitized-clone-batches";
import {
  createSanitizedCloneWriter,
  buildDestinationResetSql,
  buildSanitizedCursorQuery,
  buildSourceCopyArgs,
  buildDestinationCopyArgs,
  buildCompatibleSanitizedSelectList,
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
  runSourceCheckedClone,
  runWithDestinationCleanup,
  insertRowsWithReplicationDisabled,
  createSanitizedCloneInsertWriter,
  resolveCompatibleCopyColumns,
  sanitizeConfidentialRow,
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

  it("invalidates copied password hashes instead of preserving a live credential", () => {
    const sanitized = sanitizeConfidentialRow(
      { id: "user-1", passwordHash: "$2b$10$live-production-hash" },
      1,
    );

    expect(sanitized.passwordHash).not.toBe("$2b$10$live-production-hash");
    expect(sanitized.passwordHash).toMatch(/^\$2a\$10\$devhashplaceholder/);
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
      placeholder: "$2::\"text\"[]",
      value: "{\"a\",\"b\"}",
    });
  });

  it("casts integer arrays to their catalog element type instead of text[]", () => {
    const result = prepareInsertParameter([3001, 5433], { dataType: "ARRAY", udtName: "_int4" }, 3);

    expect(result).toEqual({
      placeholder: "$3::\"int4\"[]",
      value: "{\"3001\",\"5433\"}",
    });
  });

  it("quotes custom array element type names from the catalog", () => {
    const result = prepareInsertParameter(["open"], { dataType: "ARRAY", udtName: "_LifecycleStatus" }, 4);

    expect(result).toEqual({
      placeholder: "$4::\"LifecycleStatus\"[]",
      value: "{\"open\"}",
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

  it("checks source integrity after reset and before the first source copy", async () => {
    const events: string[] = [];

    await runSourceCheckedClone(
      async () => { events.push("reset"); },
      async () => { events.push("guard"); },
      async () => { events.push("clone"); },
    );

    expect(events).toEqual(["reset", "guard", "clone"]);
  });

  it("leaves the destination empty when the source integrity check fails", async () => {
    const events: string[] = [];

    await expect(runSourceCheckedClone(
      async () => { events.push("reset"); },
      async () => {
        events.push("guard");
        throw new Error("InventoryEntity source index disagrees with its heap");
      },
      async () => { events.push("clone"); },
    )).rejects.toThrow("source index disagrees with its heap");

    expect(events).toEqual(["reset", "guard", "reset"]);
  });
});

describe("bounded confidential inserts", () => {
  it.each(["source", "write", "commit"])("aborts streaming on a %s failure without committing the source snapshot", async failure => {
    const events: string[] = [];
    let fetches = 0;
    const source = { async query(sql: string) {
      events.push(sql);
      if (!sql.startsWith("FETCH")) return { rows: [] };
      if (++fetches === 2) {
        if (failure === "source") throw new Error("source failed");
        return { rows: [] };
      }
      return { rows: [{ id: "1" }] };
    } };
    const transaction = {
      $queryRawUnsafe: async () => [{ columnName: "id", dataType: "text", udtName: "text" }],
      $executeRawUnsafe: async (sql: string) => {
        if (sql.startsWith("INSERT") && failure === "write") throw new Error("write failed");
        return 1;
      },
    };
    const client = { $transaction: async (write: (tx: typeof transaction) => Promise<void>) => {
      await write(transaction); if (failure === "commit") throw new Error("commit failed");
    } };
    const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, transactionAttempts: 0, transactionMs: 0 };
    const writer = createSanitizedCloneWriter(client as never);
    await expect(withSanitizedCursorBatches(source, "SELECT id FROM fixture", next => writer.copyBatches("First", next, () => {}, metrics), 50, true, metrics)).rejects.toThrow(`${failure} failed`);
    expect(events.at(-1)).toBe("ROLLBACK"); expect(events).not.toContain("COMMIT");
    expect(metrics.transactionAttempts).toBe(1);
  });
  it("commits a short group after a slow fetch and carries only that unwritten batch forward", async () => {
    let clock = 0, fetches = 0;
    const measuredClock = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const transactionRows: number[] = [];
    const source = { async query(sql: string) {
      if (!sql.startsWith("FETCH")) return { rows: [] };
      fetches++;
      if (fetches === 2) clock = 1001;
      return { rows: fetches <= 2 ? Array.from({ length: 50 }, (_, i) => ({ id: `${fetches}-${i}` })) : [] };
    } };
    const transaction = {
      $queryRawUnsafe: async () => [{ columnName: "id", dataType: "text", udtName: "text" }],
      $executeRawUnsafe: async (sql: string, ...values: unknown[]) => { if (sql.startsWith("INSERT")) transactionRows[transactionRows.length - 1]! += values.length; return 1; },
    };
    const client = { $transaction: async (write: (tx: typeof transaction) => Promise<void>) => { transactionRows.push(0); await write(transaction); } };
    const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, transactionAttempts: 0, transactionMs: 0 };
    try {
      const writer = createSanitizedCloneWriter(client as never);
      await withSanitizedCursorBatches(source, "SELECT id FROM fixture", next => writer.copyBatches("First", next, () => {}, metrics), 50, true, metrics);
      expect(transactionRows).toEqual([50, 50]); expect(fetches).toBe(3);
    } finally { measuredClock.mockRestore(); }
  });
  it("opens no destination transaction for an empty source", async () => {
    const client = { $transaction: vi.fn() };
    const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, transactionAttempts: 0, transactionMs: 0 };
    const writer = createSanitizedCloneWriter(client as never);
    await withSanitizedCursorBatches({ query: async () => ({ rows: [] }) }, "SELECT id FROM fixture", next => writer.copyBatches("First", next, () => {}, metrics), 50, true, metrics);
    expect(client.$transaction).not.toHaveBeenCalled(); expect(metrics.rows).toBe(0);
  });
  it("streams successive50-row windows into transactions of at most500rows", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const transactionRows: number[] = [];
    let remaining = 1001;
    let inTransaction = false;
    const source = { async query(sql: string) {
      if (!sql.startsWith("FETCH")) return { rows: [] };
      if ((1001 - remaining) % 500 === 0) expect(inTransaction).toBe(false);
      const size = Math.min(remaining, 50); remaining -= size;
      return { rows: Array.from({ length: size }, (_, index) => ({ id: String(remaining + index) })) };
    } };
    const transaction = {
      $queryRawUnsafe: async () => [{ columnName: "id", dataType: "text", udtName: "text" }],
      $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
        if (sql.startsWith("INSERT")) transactionRows[transactionRows.length - 1]! += values.length;
        return 1;
      },
    };
    const client = { $transaction: async (write: (tx: typeof transaction) => Promise<void>) => {
      transactionRows.push(0); inTransaction = true;
      try { await write(transaction); } finally { inTransaction = false; }
    } };
    const writer = createSanitizedCloneWriter(client as never);
    const metrics = { fetchMs: 0, fetches: 0, rows: 0, batches: 0, sanitizeMs: 0, transactionAttempts: 0, transactionMs: 0 };
    try {
      await withSanitizedCursorBatches(source, "SELECT id FROM fixture", next => writer.copyBatches("First", next, () => {}, metrics), 50, true, metrics);
      expect(transactionRows).toEqual([500, 500, 1]);
    } finally { clock.mockRestore(); }
  });
  it("separates transaction callback work from acquisition and commit elapsed time", async () => {
    const metrics = { transactionAttempts: 0, transactionMs: 0, transactionWorkMs: 0 };
    const transaction = {
      $queryRawUnsafe: async () => [{ columnName: "id", dataType: "text", udtName: "text" }],
      $executeRawUnsafe: async () => 1,
    };
    const client = { $transaction: async (write: (tx: typeof transaction) => Promise<void>) => write(transaction) };
    await createSanitizedCloneInsertWriter(client as never)("First", [{ id: "1" }], metrics);
    expect(metrics.transactionWorkMs).toBeGreaterThan(0);
    expect(metrics.transactionWorkMs).toBeLessThanOrEqual(metrics.transactionMs);
  });
  it("measures transaction attempts without retaining rows or swallowing failures", async () => {
    const metrics = { transactionAttempts: 0, transactionMs: 0 };
    const client = { $transaction: async () => { throw new Error("destination unavailable"); } };
    const write = createSanitizedCloneInsertWriter(client as never);
    await expect(write("First", [{ id: "PRIVATE-ROW-VALUE" }], metrics)).rejects.toThrow("destination unavailable");
    expect(metrics.transactionAttempts).toBe(1);
    expect(metrics.transactionMs).toBeGreaterThan(0);
    expect(JSON.stringify(metrics)).not.toContain("PRIVATE-ROW-VALUE");
  });
  it("reuses metadata only within one clone attempt and refreshes each new attempt", async () => {
    const queried: string[] = [];
    const transaction = {
      $queryRawUnsafe: async (_sql: string, table: string) => {
        queried.push(table);
        return [{ columnName: "id", dataType: "text", udtName: "text" }];
      },
      $executeRawUnsafe: async () => 1,
    };
    const client = { $transaction: async (write: (tx: typeof transaction) => Promise<void>) => write(transaction) };
    const attempt = createSanitizedCloneInsertWriter(client as never);
    await attempt("First", [{ id: "1" }]);
    await attempt("First", [{ id: "2" }]);
    await attempt("Second", [{ id: "3" }]);
    expect(queried).toEqual(["First", "Second"]);
    await createSanitizedCloneInsertWriter(client as never)("First", [{ id: "4" }]);
    expect(queried).toEqual(["First", "Second", "First"]);
  });

  it("does not cache a failed metadata query", async () => {
    let reads = 0;
    const transaction = {
      $queryRawUnsafe: async () => {
        if (++reads === 1) throw new Error("catalog unavailable");
        return [{ columnName: "id", dataType: "text", udtName: "text" }];
      },
      $executeRawUnsafe: async () => 1,
    };
    const client = { $transaction: async (write: (tx: typeof transaction) => Promise<void>) => write(transaction) };
    const attempt = createSanitizedCloneInsertWriter(client as never);
    await expect(attempt("First", [{ id: "1" }])).rejects.toThrow("catalog unavailable");
    await attempt("First", [{ id: "1" }]);
    expect(reads).toBe(2);
  });

  it("writes a fetched 50-row window as one ordered parameterized statement", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRawUnsafe: async () => [{ columnName: "id", dataType: "text", udtName: "text" }],
      $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
        statements.push({ sql, values });
        return 1;
      },
    };
    const client = { $transaction: async (write: (tx: typeof transaction) => Promise<void>) => write(transaction) };
    const rows = Array.from({ length: 50 }, (_, index) => ({ id: `row-${index}` }));
    await insertRowsWithReplicationDisabled(client as never, "Window", rows);
    const inserts = statements.filter(({ sql }) => sql.startsWith("INSERT INTO"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toEqual(rows.map(row => row.id));
    expect(inserts[0]!.sql).toContain("($1), ($2)");
    expect(inserts[0]!.sql).toContain("ON CONFLICT DO NOTHING");
  });

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
    expect(events.filter((sql) => sql.startsWith("INSERT INTO"))).toHaveLength(2);
  });
});

describe("schema-compatible streaming copy", () => {
  const ordinary = (columnName: string, udtName = "text") => ({
    columnName,
    dataType: udtName === "text" ? "text" : "USER-DEFINED",
    udtName,
    isGenerated: false,
  });

  it("copies only shared non-generated columns in source order", () => {
    expect(resolveCompatibleCopyColumns(
      [ordinary("id"), ordinary("sourceAhead"), ordinary("displayName"), { ...ordinary("searchVector", "tsvector"), isGenerated: true }],
      [ordinary("displayName"), ordinary("destinationAhead"), ordinary("id"), ordinary("searchVector", "tsvector")],
      "DecisionInteraction",
    )).toEqual(["id", "displayName"]);
  });

  it("fails closed when a shared column changed type", () => {
    expect(() => resolveCompatibleCopyColumns(
      [ordinary("id", "text")],
      [ordinary("id", "uuid")],
      "Example",
    )).toThrow(/Example\.id.*text.*uuid/);
  });

  it("uses the same compatible projection before confidential rows are obfuscated", () => {
    expect(buildCompatibleSanitizedSelectList(
      [ordinary("id"), ordinary("sourceAhead"), ordinary("displayName"), ordinary("embedding", "vector")],
      [ordinary("id"), ordinary("displayName"), ordinary("embedding", "vector"), ordinary("destinationAhead")],
      "DecisionInteraction",
    )).toBe('"id", "displayName", NULL::text AS "embedding"');
  });

  it("passes URLs and catalog-derived identifiers as process arguments", () => {
    expect(buildSourceCopyArgs("postgresql://source/db?x=1&y=2", 'odd"table', ["id", 'display"Name'])).toEqual([
      "--dbname=postgresql://source/db?x=1&y=2",
      "--set=ON_ERROR_STOP=1",
      '--command=COPY (SELECT "id", "display""Name" FROM "odd""table") TO STDOUT WITH (FORMAT binary)',
    ]);
    expect(buildDestinationCopyArgs("postgresql://destination/db?x=1&y=2", 'odd"table', ["id", 'display"Name'])).toEqual([
      "--dbname=postgresql://destination/db?x=1&y=2",
      "--set=ON_ERROR_STOP=1",
      '--command=COPY "odd""table" ("id", "display""Name") FROM STDIN WITH (FORMAT binary)',
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
    expect(shouldSkipTable("UserGroup")).toBe(true);
  });

  it("keeps provider connections with their restricted provider parent", () => {
    expect(shouldSkipTable("ModelProvider")).toBe(true);
    expect(shouldSkipTable("AiProviderConnection")).toBe(true);
  });

  it("applies restricted model classifications to mapped physical table names", () => {
    expect(shouldSkipTable("VectorEmbedding")).toBe(true);
    expect(shouldSkipTable("vector_embedding")).toBe(true);
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


describe("confidential cursor order", () => {
  it("streams by the original key while retaining the ordinal as a tie breaker", () => {
    const sql = buildSanitizedCursorQuery("QueueTelemetryEvent", '"id", "name"', new Set(["id", "name"]));
    expect(sql).toMatch(/ORDER BY r\."id" ASC, r\."__dpfCloneRowOrder"$/);
  });

  it("keeps the audit cohort and descending original keys", () => {
    const sql = buildSanitizedCursorQuery("Audit", '"id", "createdAt"', new Set(["id", "createdAt"]), 50);
    expect(sql).toContain('ORDER BY "createdAt" DESC, "id" DESC LIMIT 50');
    expect(sql).toMatch(/ORDER BY r\."createdAt" DESC, r\."id" DESC, r\."__dpfCloneRowOrder"$/);
  });

  it("preserves the physical-order fallback when no projected ordering key exists", () => {
    const sql = buildSanitizedCursorQuery("NoId", '"userId"', new Set(["userId"]));
    expect(sql).toContain('row_number() OVER (ORDER BY ctid)');
    expect(sql).toMatch(/ORDER BY r\."__dpfCloneRowOrder"$/);
  });
});
