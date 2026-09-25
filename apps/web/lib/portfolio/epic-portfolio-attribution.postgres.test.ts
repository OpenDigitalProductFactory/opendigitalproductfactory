import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadEpicPortfolioProposals } from "./epic-portfolio-attribution";

// Explicit opt-in to a governed PostgreSQL target. Every statement is read-only.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

databaseSuite("epic portfolio proposals on PostgreSQL (BI-A73A7DA3)", () => {
  let client: Client;
  const db = {
    $queryRaw: async <T,>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
      const text = parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
      return (await client.query(text, values)).rows as T;
    },
  };

  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=15000" });
    await client.connect();
  });
  afterAll(async () => { await client?.end(); });

  it("gives every epic exactly one proposal, with its evidence and a confidence (AC-1)", async () => {
    const proposals = await loadEpicPortfolioProposals(db);
    const { rows: [count] } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM "Epic"`);
    expect(proposals).toHaveLength(Number(count!.n));
    expect(new Set(proposals.map((p) => p.epicId)).size).toBe(proposals.length);
    for (const proposal of proposals) {
      expect(["high", "low"]).toContain(proposal.confidence);
      expect(proposal.evidence.attributedItems).toBeGreaterThanOrEqual(0);
    }
  });
});
