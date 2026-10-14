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
vi.mock("@/lib/govern/activate-provider", () => ({ activateProvider: vi.fn() }));
vi.mock("@/lib/portal-url", () => ({ getStablePortalUrl: () => "https://localhost" }));
vi.mock("@/lib/inference/provider-account-management", () => ({ ACCOUNT_ACCESS_RESET: {}, invalidateProviderAccountProofs: vi.fn() }));
import { refreshOAuthToken } from "./provider-oauth";
import type { ActiveAccountSnapshot } from "@/lib/inference/active-provider-account-verification";

// Opt in only to an explicit SQL fixture or the governed local-CI slot DB.
// A generated schema shadows all three touched tables. Never use install credentials.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const schema = `oauth_composition_test_${randomUUID().replaceAll("-", "")}`;
const jwt = (identity: string) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: identity } })).toString("base64url")}.signature`;
const answer = () => ({ ok: true, json: async () => ({ access_token: jwt("shared"), refresh_token: "rotated", expires_in: 3600 }) }) as Response;

describe.skipIf(!url)("OAuth pair composition on PostgreSQL", () => {
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
    for (const providerId of ["codex", "chatgpt"]) {
      await db.modelProvider.create({ data: { providerId, name: "Fixture", families: [], tokenUrl: "https://auth.openai.com/oauth/token", oauthClientId: "fixture" } });
      const credential = await db.credentialEntry.create({ data: { id: `credential-${providerId}`, providerId, cachedToken: `enc:${jwt("shared")}`, refreshToken: "enc:shared", status: "ok" } });
      await db.aiProviderConnection.create({ data: { id: `connection-${providerId}`, connectionId: `provider-default-${providerId}`, providerId, credentialEntryId: credential.id, executionChannel: "responses", authMethod: "oauth", status: "active" } });
    }
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^oauth_composition_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  async function capture(): Promise<ActiveAccountSnapshot> {
    const row = await db.aiProviderConnection.findUniqueOrThrow({ where: { connectionId: "provider-default-codex" }, include: { credentialEntry: true } });
    const credential = row.credentialEntry!;
    return { providerId: row.providerId, connectionId: row.connectionId, credentialEntryId: credential.id, updatedAt: row.updatedAt,
      credentialRevision: { updatedAt: credential.updatedAt, cachedToken: credential.cachedToken, refreshToken: credential.refreshToken } };
  }
  const tokens = async () => (await db.credentialEntry.findMany({ orderBy: { id: "asc" } })).map(row => ({ id: row.id, token: row.cachedToken, refresh: row.refreshToken }));

  it("updates both proven participants and advances the selected snapshot after commit", async () => {
    const active = await capture();
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ token: jwt("shared") });
    expect((await tokens()).map(row => row.refresh)).toEqual(["enc:rotated", "enc:rotated"]);
    const saved = await db.credentialEntry.findUniqueOrThrow({ where: { id: active.credentialEntryId } });
    expect(active.credentialRevision).toEqual({ updatedAt: saved.updatedAt, cachedToken: saved.cachedToken, refreshToken: saved.refreshToken });
  });

  it("rolls back the first participant when a second credential changes during HTTP", async () => {
    const active = await capture(), originalRevision = structuredClone(active.credentialRevision);
    vi.mocked(fetch).mockImplementation(async () => {
      // Codex is the second sorted participant. Keep updatedAt deliberately
      // unchanged to prove the full ciphertext CAS, not timestamp coincidence.
      await pool.query('UPDATE "CredentialEntry" SET "cachedToken"=$1 WHERE id=$2', ["enc:replacement", "credential-codex"]);
      return answer();
    });
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.any(String) });
    const saved = await tokens();
    expect(saved.find(row => row.id === "credential-chatgpt")!.refresh).toBe("enc:shared");
    expect(saved.find(row => row.id === "credential-codex")!).toMatchObject({ token: "enc:replacement", refresh: "enc:shared" });
    expect(active.credentialRevision).toEqual(originalRevision);
  });

  it("does not write either captured credential after the sibling is disabled", async () => {
    const active = await capture(), before = await tokens();
    vi.mocked(fetch).mockImplementation(async () => {
      await db.aiProviderConnection.update({ where: { connectionId: "provider-default-chatgpt" }, data: { status: "disabled" } });
      return answer();
    });
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.any(String) });
    expect(await tokens()).toEqual(before);
  });

  it("holds both owner locks until the paired credential write commits", async () => {
    const active = await capture();
    let reached!: () => void, proceed!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { proceed = resolve; });
    // Interpose only at the real write port; transaction, locks and CAS execute
    // on PostgreSQL. A concurrent owner update must time out while locked.
    const transaction = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementation((async (run: (tx: unknown) => Promise<unknown>) => transaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === "credentialEntry") return { ...target.credentialEntry, updateMany: async (...args: Parameters<typeof target.credentialEntry.updateMany>) => {
          reached(); await released; return target.credentialEntry.updateMany(...args);
        } };
        const value = target[key as keyof typeof target]; return typeof value === "function" ? value.bind(target) : value;
      } });
      return run(wrapped);
    })) as typeof db.$transaction);
    const writing = refreshOAuthToken("codex", active.connectionId, active);
    try {
      await Promise.race([entered, writing.then(() => { throw new Error("Renewal finished without owner locks"); })]);
      const competing = await pool.connect();
      try {
        await competing.query("SET lock_timeout='100ms'");
        await expect(competing.query('UPDATE "AiProviderConnection" SET status=$1 WHERE "connectionId"=$2', ["disabled", "provider-default-chatgpt"])).rejects.toMatchObject({ code: "55P03" });
      } finally { competing.release(); }
    } finally { proceed(); spy.mockRestore(); }
    expect(await writing).toEqual({ token: jwt("shared") });
    expect((await tokens()).every(row => row.refresh === "enc:rotated")).toBe(true);
  }, 15_000);
});
