import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { READ_ONLY_STATEMENT, withReadOnlyTransaction } from "./approval-convergence-probe-run";

// Explicit opt-in to a governed PostgreSQL target (BI-129EFFD1). Proves the
// probe's guarantee on the real database: a transaction opened by
// withReadOnlyTransaction refuses a write, and nothing it attempted persists.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

databaseSuite("AC-PROBE read-only transaction on PostgreSQL", () => {
  let client: Client;
  // A permanent table, not TEMP: PostgreSQL lets a read-only transaction write to
  // temporary tables, so a TEMP target cannot prove the guard refuses a write.
  const table = `ac_probe_write_target_${process.pid}_${Date.now()}`;
  // The interactive-transaction shape Prisma gives the runner, over one pg connection.
  const db = {
    $transaction: async <T,>(work: (tx: never) => Promise<T>): Promise<T> => {
      await client.query("BEGIN");
      try {
        const result = await work({ $executeRawUnsafe: (sql: string) => client.query(sql) } as never);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
  };

  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c statement_timeout=15000" });
    await client.connect();
    await client.query(`CREATE TABLE "${table}" (id int)`);
  });
  afterAll(async () => {
    await client?.query(`DROP TABLE IF EXISTS "${table}"`).catch(() => undefined);
    await client?.end();
  });

  it("refuses a write inside the evaluation and persists nothing", async () => {
    await expect(withReadOnlyTransaction(db as never, async (tx: { $executeRawUnsafe(sql: string): Promise<unknown> }) => {
      const { rows } = await client.query("SHOW transaction_read_only") as { rows: Array<{ transaction_read_only: string }> };
      expect(rows[0].transaction_read_only).toBe("on");
      await tx.$executeRawUnsafe(`INSERT INTO "${table}" (id) VALUES (1)`);
    })).rejects.toThrow(/read-only transaction/);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
    expect(rows[0].n).toBe(0);
    expect(READ_ONLY_STATEMENT).toBe("SET TRANSACTION READ ONLY");
  });
});
