import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSourceCheckedClone } from "./sanitized-clone";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `sanitized_clone_integrity_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function destinationCount(): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}"."Destination"`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

describeDatabase("sanitized clone publication with PostgreSQL", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`
      CREATE TABLE "${schema}"."Destination" (
        id TEXT PRIMARY KEY,
        "entityKey" TEXT NOT NULL UNIQUE
      )
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("empties the destination after a real unique-constraint clone failure", async () => {
    await client.query(
      `INSERT INTO "${schema}"."Destination" (id, "entityKey")
       VALUES ('stale', 'stale')`,
    );

    await expect(runSourceCheckedClone(
      async () => {
        await client.query(`TRUNCATE TABLE "${schema}"."Destination"`);
      },
      async () => {
        await client.query("SELECT 1");
      },
      async () => {
        await client.query(
          `INSERT INTO "${schema}"."Destination" (id, "entityKey")
           VALUES ('a', 'duplicate'), ('b', 'duplicate')`,
        );
      },
    )).rejects.toMatchObject({ code: "23505" });

    expect(await destinationCount()).toBe(0);
  });

  it("publishes the destination when the source guard and clone both succeed", async () => {
    await runSourceCheckedClone(
      async () => {
        await client.query(`TRUNCATE TABLE "${schema}"."Destination"`);
      },
      async () => {
        await client.query("SELECT 1");
      },
      async () => {
        await client.query(
          `INSERT INTO "${schema}"."Destination" (id, "entityKey")
           VALUES ('healthy', 'healthy')`,
        );
      },
    );

    expect(await destinationCount()).toBe(1);
  });
});
