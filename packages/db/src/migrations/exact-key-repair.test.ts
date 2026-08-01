import { describe, it, expect } from "vitest";

import {
  buildExactKeyRepairSql,
  type ExactKeyRepairConfig,
} from "./exact-key-repair";

// A minimal single-column config mirroring the ScheduledJob template.
function scheduledJobConfig(overrides: Partial<ExactKeyRepairConfig> = {}): ExactKeyRepairConfig {
  return {
    table: "ScheduledJob",
    keyColumns: ["jobId"],
    survivorOrder: '"updatedAt" DESC, "lastRunAt" DESC NULLS LAST, "createdAt" DESC, id DESC',
    uniqueIndexName: "ScheduledJob_jobId_key",
    reason: "BI-TEST — restore ScheduledJob heap/index agreement.",
    ...overrides,
  };
}

describe("buildExactKeyRepairSql — the ratified sequence", () => {
  const sql = buildExactKeyRepairSql(scheduledJobConfig());

  it("emits every step of the ratified sequence, in order", () => {
    const order = [
      "BEGIN;",
      "SET LOCAL enable_indexscan = off;",
      "SET LOCAL enable_indexonlyscan = off;",
      "SET LOCAL enable_bitmapscan = off;",
      "row_number() OVER (",
      "__dpf_quarantined__",
      "RAISE EXCEPTION",
      'DROP INDEX IF EXISTS "ScheduledJob_jobId_key";',
      'CREATE UNIQUE INDEX "ScheduledJob_jobId_key"',
      "COMMIT;",
    ];
    let cursor = 0;
    for (const token of order) {
      const at = sql.indexOf(token, cursor);
      expect(at, `"${token}" must appear after the previous step`).toBeGreaterThan(-1);
      cursor = at;
    }
  });

  it("disables all three index scan classes so ranking and assertion read the heap", () => {
    expect(sql).toContain("SET LOCAL enable_indexscan = off;");
    expect(sql).toContain("SET LOCAL enable_indexonlyscan = off;");
    expect(sql).toContain("SET LOCAL enable_bitmapscan = off;");
  });

  it("ranks by the declared survivor ordering, keeping row 1", () => {
    expect(sql).toContain(
      'ORDER BY "updatedAt" DESC, "lastRunAt" DESC NULLS LAST, "createdAt" DESC, id DESC',
    );
    expect(sql).toContain("WHERE duplicate_rank > 1");
  });

  it("uses the collision-checked reserved-namespace rename", () => {
    expect(sql).toContain(
      "quarantine_key := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row.original_key;",
    );
    expect(sql).toMatch(/WHILE EXISTS \([\s\S]*?quarantine_key := quarantine_key \|\| '_';/);
  });

  it("carries a heap-grounded fail-closed assertion before the index rebuild", () => {
    const assertAt = sql.indexOf("RAISE EXCEPTION");
    const rebuildAt = sql.indexOf("CREATE UNIQUE INDEX");
    expect(assertAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(rebuildAt);
    expect(sql).toContain("HAVING count(*) > 1");
  });

  it("drops then recreates the unique index from the repaired heap", () => {
    const drop = sql.indexOf('DROP INDEX IF EXISTS "ScheduledJob_jobId_key";');
    const create = sql.indexOf('CREATE UNIQUE INDEX "ScheduledJob_jobId_key" ON "ScheduledJob" ("jobId");');
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  it("adds no FK detach/reattach when none are declared", () => {
    expect(sql).not.toContain("DROP CONSTRAINT");
    expect(sql).not.toContain("ADD CONSTRAINT");
  });

  it("adds no retirement clause when none is declared", () => {
    // The rename UPDATE sets only the quarantine column.
    expect(sql).toMatch(/SET "jobId" = quarantine_key\s*\n\s*WHERE id = duplicate_row\.id;/);
  });
});

describe("retirement — the #3374 gap this helper closes", () => {
  it("applies retirement assignments in the SAME update that renames the loser", () => {
    const sql = buildExactKeyRepairSql(
      scheduledJobConfig({
        table: "DigitalProduct",
        keyColumns: ["productId"],
        survivorOrder: '"createdAt", id',
        uniqueIndexName: "DigitalProduct_productId_key",
        retirement: [
          { column: "lifecycleStatus", value: "'retired'" },
          { column: "coverageStatus", value: "'quarantined'" },
          { column: "updatedAt", value: "now()" },
        ],
        reason: "BI-TEST — DigitalProduct with retirement.",
      }),
    );
    // A single UPDATE assigns the key AND the retirement columns.
    expect(sql).toMatch(
      /UPDATE "DigitalProduct"\s*\n\s*SET "productId" = quarantine_key,\s*\n\s*"lifecycleStatus" = 'retired',\s*\n\s*"coverageStatus" = 'quarantined',\s*\n\s*"updatedAt" = now\(\)\s*\n\s*WHERE id = duplicate_row\.id;/,
    );
    // The fleet-safety header advertises that no follow-up is needed.
    expect(sql).toContain("no follow-up migration is needed");
  });
});

describe("natural-key foreign keys — detach before, reattach after", () => {
  const sql = buildExactKeyRepairSql(
    scheduledJobConfig({
      table: "DigitalProduct",
      keyColumns: ["productId"],
      survivorOrder: '"createdAt", id',
      uniqueIndexName: "DigitalProduct_productId_key",
      naturalKeyForeignKeys: [
        {
          childTable: "CoworkerService",
          constraint: "CoworkerService_digitalProductId_fkey",
          childColumns: ["digitalProductId"],
          parentColumns: ["productId"],
          onDelete: "SET NULL",
          onUpdate: "CASCADE",
        },
      ],
      reason: "BI-TEST — DigitalProduct with FK detach.",
    }),
  );

  it("detaches the FK before the quarantine loop and reattaches after the index rebuild", () => {
    const detach = sql.indexOf(
      'DROP CONSTRAINT IF EXISTS "CoworkerService_digitalProductId_fkey"',
    );
    const loop = sql.indexOf("FOR duplicate_row IN");
    const rebuild = sql.indexOf("CREATE UNIQUE INDEX");
    const reattach = sql.indexOf(
      'ADD CONSTRAINT "CoworkerService_digitalProductId_fkey"',
    );
    expect(detach).toBeGreaterThan(-1);
    expect(detach).toBeLessThan(loop); // detach precedes the rename
    expect(reattach).toBeGreaterThan(rebuild); // reattach follows the rebuild
  });

  it("restores the exact FK definition, referencing the natural key not id", () => {
    expect(sql).toContain(
      'FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("productId")\n' +
        "  ON DELETE SET NULL ON UPDATE CASCADE;",
    );
  });
});

describe("multi-column keys", () => {
  const sql = buildExactKeyRepairSql({
    table: "ModelProfile",
    keyColumns: ["providerId", "modelId"],
    quarantineColumn: "modelId",
    survivorOrder: '"lastEvalAt" DESC NULLS LAST, "evalCount" DESC, id DESC',
    uniqueIndexName: "ModelProfile_providerId_modelId_key",
    reason: "BI-TEST — ModelProfile composite key.",
  });

  it("partitions and asserts on the full composite key", () => {
    expect(sql).toContain('PARTITION BY "providerId", "modelId"');
    expect(sql).toContain('GROUP BY "providerId", "modelId"');
  });

  it("quarantines only the designated column and rebuilds the composite index", () => {
    expect(sql).toContain('SET "modelId" = quarantine_key');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "ModelProfile_providerId_modelId_key" ON "ModelProfile" ("providerId", "modelId");',
    );
  });

  it("defaults the quarantine column to the LAST key column when unspecified", () => {
    const s = buildExactKeyRepairSql({
      table: "DiscoveredModel",
      keyColumns: ["providerId", "modelId"],
      survivorOrder: "id",
      uniqueIndexName: "DiscoveredModel_providerId_modelId_key",
      reason: "BI-TEST — default quarantine column.",
    });
    expect(s).toContain('AS original_key'); // present
    expect(s).toContain('SET "modelId" = quarantine_key'); // last column
  });
});

describe("validation — malformed input fails loud, not silently", () => {
  it("rejects an empty key", () => {
    expect(() =>
      buildExactKeyRepairSql(scheduledJobConfig({ keyColumns: [] })),
    ).toThrow(/keyColumns must be non-empty/);
  });

  it("rejects a quarantine column that is not part of the key", () => {
    expect(() =>
      buildExactKeyRepairSql(scheduledJobConfig({ quarantineColumn: "notAKeyColumn" })),
    ).toThrow(/must be one of keyColumns/);
  });

  it("rejects an identifier carrying a quote or semicolon (SQL-shape guard)", () => {
    expect(() =>
      buildExactKeyRepairSql(scheduledJobConfig({ table: 'Sched"; DROP' })),
    ).toThrow(/invalid table identifier/);
  });

  it("rejects an empty survivor order", () => {
    expect(() =>
      buildExactKeyRepairSql(scheduledJobConfig({ survivorOrder: "   " })),
    ).toThrow(/survivorOrder is required/);
  });
});

describe("golden equivalence with the ratified hand-written templates", () => {
  // The generator must reproduce the semantics of the templates it replaces.
  // We assert on the load-bearing lines rather than byte-identity, since the
  // hand-written files carry bespoke prose comments.
  it("reproduces the ScheduledJob (simple) template's operative SQL", () => {
    const sql = buildExactKeyRepairSql(scheduledJobConfig());
    for (const line of [
      "SET LOCAL enable_indexscan = off;",
      'PARTITION BY "jobId"',
      "quarantine_key := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row.original_key;",
      "RAISE EXCEPTION 'ScheduledJob integrity repair left duplicate keys';",
      'DROP INDEX IF EXISTS "ScheduledJob_jobId_key";',
      'CREATE UNIQUE INDEX "ScheduledJob_jobId_key" ON "ScheduledJob" ("jobId");',
    ]) {
      expect(sql).toContain(line);
    }
  });

  it("reproduces the DigitalProduct (FK detach + retirement) template's operative SQL", () => {
    const sql = buildExactKeyRepairSql({
      table: "DigitalProduct",
      keyColumns: ["productId"],
      survivorOrder: '"createdAt", id',
      uniqueIndexName: "DigitalProduct_productId_key",
      retirement: [
        { column: "lifecycleStatus", value: "'retired'" },
        { column: "coverageStatus", value: "'quarantined'" },
        { column: "updatedAt", value: "now()" },
      ],
      naturalKeyForeignKeys: [
        {
          childTable: "CoworkerService",
          constraint: "CoworkerService_digitalProductId_fkey",
          childColumns: ["digitalProductId"],
          parentColumns: ["productId"],
          onDelete: "SET NULL",
          onUpdate: "CASCADE",
        },
        {
          childTable: "CoworkerOffer",
          constraint: "CoworkerOffer_digitalProductId_fkey",
          childColumns: ["digitalProductId"],
          parentColumns: ["productId"],
          onDelete: "SET NULL",
          onUpdate: "CASCADE",
        },
      ],
      reason: "BI-TEST — DigitalProduct full template.",
    });
    for (const line of [
      'DROP CONSTRAINT IF EXISTS "CoworkerService_digitalProductId_fkey";',
      'DROP CONSTRAINT IF EXISTS "CoworkerOffer_digitalProductId_fkey";',
      '"lifecycleStatus" = \'retired\'',
      "RAISE EXCEPTION 'DigitalProduct integrity repair left duplicate keys';",
      'ADD CONSTRAINT "CoworkerService_digitalProductId_fkey"',
      'ADD CONSTRAINT "CoworkerOffer_digitalProductId_fkey"',
    ]) {
      expect(sql).toContain(line);
    }
  });
});
