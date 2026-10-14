import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: undefined as unknown as PrismaClient }));
vi.mock("@dpf/db", () => ({ prisma: new Proxy({}, { get: (_target, key) => {
  const value = state.db[key as keyof PrismaClient];
  return typeof value === "function" ? value.bind(state.db) : value;
} }) }));
vi.mock("@/lib/credential-crypto", () => ({ encryptSecret: (value: string) => `enc:${value}`, decryptSecret: (value: string | null) => value?.replace(/^enc:/, "") ?? null }));
import { getProviderBearerToken } from "./provider-account-credentials";

// Only an explicit fixture or governed CI database; never install credentials.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const schema = `workload_token_test_${randomUUID().replaceAll("-", "")}`;
const answer = () => new Response(JSON.stringify({ access_token: "owned-token", expires_in: 3600 }), { status: 200 });

describe.skipIf(!url)("account workload token persistence on PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=10000`, max: 4 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) }); state.db = db;
    for (const table of ["ModelProvider", "CredentialEntry", "AiProviderConnection"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "AiProviderConnection", "CredentialEntry", "ModelProvider"');
    await db.modelProvider.create({ data: { providerId: "workload", name: "Fixture", families: [], authMethod: "oauth2_client_credentials" } });
    await db.credentialEntry.create({ data: { id: "owned", clientId: "fixture-client", clientSecret: "enc:fixture-secret", tokenEndpoint: "https://fixture.invalid/token", status: "pending" } });
    await db.aiProviderConnection.create({ data: { id: "immutable-a", connectionId: "account-a", providerId: "workload", credentialEntryId: "owned", executionChannel: "http", authMethod: "workload-identity", status: "unconfigured" } });
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^workload_token_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  const saved = () => db.credentialEntry.findUniqueOrThrow({ where: { id: "owned" } });

  it("persists initial verification without enabling the account", async () => {
    expect(await getProviderBearerToken("workload", "account-a")).toEqual({ token: "owned-token" });
    expect(await saved()).toMatchObject({ cachedToken: "enc:owned-token", status: "ok" });
    expect((await db.aiProviderConnection.findUniqueOrThrow({ where: { connectionId: "account-a" } })).status).toBe("unconfigured");
  });

  it("does not persist a response after the owner is disabled during HTTP", async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      await db.aiProviderConnection.update({ where: { connectionId: "account-a" }, data: { status: "disabled" } });
      return answer();
    });
    expect(await getProviderBearerToken("workload", "account-a")).toEqual({ error: expect.stringContaining("changed") });
    expect(await saved()).toMatchObject({ cachedToken: null, status: "pending" });
  });

  it("preserves same-timestamp credential replacement during HTTP", async () => {
    const before = await saved();
    vi.mocked(fetch).mockImplementation(async () => {
      await pool.query('UPDATE "CredentialEntry" SET "clientSecret"=$1 WHERE id=$2', ["enc:replacement", "owned"]);
      return answer();
    });
    expect(await getProviderBearerToken("workload", "account-a")).toEqual({ error: expect.stringContaining("changed") });
    expect(await saved()).toMatchObject({ clientSecret: "enc:replacement", cachedToken: null, updatedAt: before.updatedAt });
  });

  it("locks the owner until the real conditional credential write commits", async () => {
    let reached!: () => void, proceed!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { proceed = resolve; });
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, "$transaction").mockImplementation((async (run: (tx: unknown) => Promise<unknown>) => transaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === "credentialEntry") return { ...target.credentialEntry, updateMany: async (...args: Parameters<typeof target.credentialEntry.updateMany>) => {
          reached(); await released; return target.credentialEntry.updateMany(...args);
        } };
        const value = target[key as keyof typeof target]; return typeof value === "function" ? value.bind(target) : value;
      } });
      return run(wrapped);
    })) as typeof db.$transaction);
    const writing = getProviderBearerToken("workload", "account-a");
    try {
      await Promise.race([entered, writing.then(() => { throw new Error("Exchange finished without owner lock"); })]);
      const competing = await pool.connect();
      try {
        await competing.query("SET lock_timeout='100ms'");
        await expect(competing.query('UPDATE "AiProviderConnection" SET status=$1 WHERE "connectionId"=$2', ["disabled", "account-a"])).rejects.toMatchObject({ code: "55P03" });
      } finally { competing.release(); }
    } finally { proceed(); }
    expect(await writing).toEqual({ token: "owned-token" });
    expect(await saved()).toMatchObject({ cachedToken: "enc:owned-token", status: "ok" });
  }, 15_000);
});
