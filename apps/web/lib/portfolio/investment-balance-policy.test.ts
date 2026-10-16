import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { defaultBalancePolicy } from "./investment-balance";
import { fundingAuthority, recordedFundingOwner, policyScopeKey, readPolicyRevision, writePolicyRevision } from "./investment-balance-policy";

const owner = { principalId: "p1", organizationId: "org1", purpose: "shared-platform" as const };
const facts = { activePerson: true, activeAccount: true, founderPrincipalId: "p1", founderOrganizationId: "org1", resolvedOrganizationId: "org1", organizationOwnerPrincipalId: "p2", organizationExists: true };
const input = { scope: owner, policy: defaultBalancePolicy("founder", "shared-platform"), expectedRevision: null, actorPrincipalId: "p1", reason: "Founder allocation", authority: facts, now: new Date("2026-10-13T00:00:00Z") };

function memoryDb() {
  const rows = new Map<string, unknown>();
  const db = {
    platformConfig: {
      findUnique: async ({ where }: any) => rows.has(where.key) ? { value: rows.get(where.key) } : null,
      create: async ({ data }: any) => { if (rows.has(data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" }); rows.set(data.key, data.value); return data; },
      updateMany: async ({ where, data }: any) => { if (JSON.stringify(rows.get(where.key)) !== JSON.stringify(where.value.equals)) return { count: 0 }; rows.set(where.key, data.value); return { count: 1 }; },
    },
    $transaction: async <T>(fn: (tx: any) => Promise<T>) => { const before = new Map(rows); try { return await fn(db); } catch (e) { rows.clear(); for (const [k,v] of before) rows.set(k,v); throw e; } },
  };
  return { db, rows };
}

describe("investment policy authority and immutable revisions", () => {
  it("requires recorded funding ownership rather than administrator or executor identity", () => {
    expect(fundingAuthority(owner, facts)).toBe("founder");
    expect(fundingAuthority({ ...owner, principalId: "p2" }, facts)).toBe("organization");
    expect(fundingAuthority({ ...owner, principalId: "admin" }, facts)).toBeNull();
    expect(fundingAuthority(owner, { ...facts, activePerson: false })).toBeNull();
    expect(fundingAuthority(owner, { ...facts, activeAccount: false })).toBeNull();
    expect(fundingAuthority(owner, { ...facts, organizationExists: false })).toBeNull();
    expect(fundingAuthority(owner, { ...facts, founderOrganizationId: "foreign" })).toBeNull();
    expect(fundingAuthority(owner, { ...facts, resolvedOrganizationId: "foreign" })).toBeNull();
  });
  it("does not collide ambiguous scope components", () => {
    expect(policyScopeKey({ ...owner, principalId: "a:b", organizationId: "c" })).not.toBe(policyScopeKey({ ...owner, principalId: "a", organizationId: "b:c" }));
  });
  it("does not treat a disabled account as consent to transfer its funding", () => {
    const disabled = { ...facts, activePerson: false, activeAccount: false };
    expect(fundingAuthority(owner, disabled)).toBeNull();
    expect(recordedFundingOwner(owner, disabled)).toBe("founder");
  });
  it("preserves previous policy and records actor and reason when changing the current revision", async () => {
    const { db } = memoryDb();
    const first = await writePolicyRevision(db, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await writePolicyRevision(db, { ...input, expectedRevision: first.data.revision, policy: { ...input.policy, refactorPercent: 70 }, reason: "Maturity review" });
    expect(second.ok).toBe(true);
    const historical = await readPolicyRevision(db, owner, first.data.revision);
    expect(historical).toMatchObject({ policy: { refactorPercent: 80 }, actorPrincipalId: "p1", reason: "Founder allocation" });
    if (second.ok) expect(second.data.previousRevision).toBe(first.data.revision);
  });
  it("rejects stale writes without replacing the current choice", async () => {
    const { db, rows } = memoryDb();
    await writePolicyRevision(db, input);
    const before = new Map(rows);
    expect(await writePolicyRevision(db, input)).toMatchObject({ ok: false, error: "stale-revision" });
    expect(rows).toEqual(before);
  });
  it.each([
    [{ actorPrincipalId: "p2" }, "not-owner"],
    [{ reason: " " }, "reason-required"],
    [{ authority: { ...facts, activePerson: false } }, "unresolved-authority"],
    [{ policy: { ...input.policy, windowDays: 999 } }, "invalid-policy"],
  ])("refuses unsafe writes %o", async (change, error) => {
    const { db, rows } = memoryDb();
    expect(await writePolicyRevision(db, { ...input, ...change })).toMatchObject({ ok: false, error });
    expect(rows.size).toBe(0);
  });
});

const sqlUrl = process.env.DPF_SQL_TEST_DATABASE_URL ?? ((process.env.CI === "true" || Boolean(process.env.DPF_LOCAL_CI_METADATA_FILE)) ? process.env.DATABASE_URL : undefined);
(sqlUrl ? describe : describe.skip)("investment revision compare-and-swap on PostgreSQL", () => {
  it("commits exactly one concurrent successor and rolls back the losing revision", async () => {
    const clients = [new Client({ connectionString: sqlUrl }), new Client({ connectionString: sqlUrl })];
    const scope = { ...owner, principalId: `investment-${randomUUID()}` };
    const args = { ...input, scope, actorPrincipalId: scope.principalId, authority: { ...facts, founderPrincipalId: scope.principalId } };
    let release: () => void = () => {};
    let arrivals = 0;
    let race = false;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const adapters = clients.map((client) => {
      const db = {
        platformConfig: {
          findUnique: async ({ where }: any) => {
            const row = (await client.query('SELECT value FROM "PlatformConfig" WHERE key=$1', [where.key])).rows[0] ?? null;
            if (race && where.key.endsWith(":current")) { if (++arrivals === 2) release(); await bothRead; }
            return row;
          },
          create: async ({ data }: any) => client.query('INSERT INTO "PlatformConfig" (id,key,value,"updatedAt") VALUES ($1,$2,$3::jsonb,now())', [randomUUID(), data.key, JSON.stringify(data.value)]),
          updateMany: async ({ where, data }: any) => ({ count: (await client.query('UPDATE "PlatformConfig" SET value=$1::jsonb,"updatedAt"=now() WHERE key=$2 AND value=$3::jsonb', [JSON.stringify(data.value), where.key, JSON.stringify(where.value.equals)])).rowCount ?? 0 }),
        },
        $transaction: async <T,>(fn: (tx: any) => Promise<T>) => {
          await client.query("BEGIN");
          try { const result = await fn(db); await client.query("COMMIT"); return result; }
          catch (error) { await client.query("ROLLBACK"); throw error; }
        },
      };
      return db;
    });
    try {
      await Promise.all(clients.map((client) => client.connect()));
      const first = await writePolicyRevision(adapters[0], args);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      race = true;
      const results = await Promise.all(adapters.map((db, i) => writePolicyRevision(db, { ...args, expectedRevision: first.data.revision, reason: `Concurrent choice ${i}`, policy: { ...args.policy, refactorPercent: 60 + i } })));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "stale-revision" }]);
      const rows = await clients[0].query('SELECT key FROM "PlatformConfig" WHERE starts_with(key,$1)', [policyScopeKey(scope)]);
      expect(rows.rows).toHaveLength(3); // Original, winning successor, current pointer.
    } finally {
      await clients[0].query('DELETE FROM "PlatformConfig" WHERE starts_with(key,$1)', [policyScopeKey(scope)]);
      await Promise.all(clients.map((client) => client.end()));
    }
  });
});
