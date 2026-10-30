import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown as PrismaClient }));
vi.mock("@dpf/db", async () => {
  const { Prisma } = await import("../../../../../packages/db/generated/client/client");
  return { Prisma, prisma: new Proxy({}, { get: (_target, key) => {
    const value = state.db[key as keyof PrismaClient]; return typeof value === "function" ? value.bind(state.db) : value;
  } }) };
});
import { captureExecutionProofBinding, persistExecutionProof, readCurrentExecutionProof } from "./execution-proof.server";
import { loadProviderCapacitySnapshots, clearProviderCapacityStatus, capacityAccountIdentity, recordProviderCapacityStatus } from "./store";
import { applyCapacitySoftExclusion } from "../capacity-routing-exclude";

const leased = process.env.DPF_NONPROD_LEASE_ID && process.env.DATABASE_URL
  && /^\/dpf_local_ci_\d+$/.test(new URL(process.env.DATABASE_URL).pathname) ? process.env.DATABASE_URL : undefined;
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
const schema = `quota_proof_test_${randomUUID().replaceAll("-", "")}`;
const tables = ["ModelProvider", "CredentialEntry", "AiProviderConnection", "ModelProfile", "ProviderCapacityStatus", "CliPoolStatus", "ScheduledJob"];
const connectionId = "provider-default-chatgpt", modelId = "proof-fixture-model";

describe.skipIf(!url)("exact quota proof on isolated leased PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=10000`, max: 4 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) }); state.db = db;
    // Table structure only. No install records, credentials, business data or full-size copy.
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(", ")}`);
    await db.modelProvider.create({ data: { providerId: "chatgpt", name: "Fixture", status: "active", families: [], authMethod: "oauth2_authorization_code", baseUrl: "https://fixture.invalid/backend-api" } });
    await db.credentialEntry.create({ data: { id: "fixture-credential", status: "ok", cachedToken: "synthetic-ciphertext", refreshToken: "synthetic-refresh" } });
    await db.aiProviderConnection.create({ data: { id: "fixture-account", connectionId, providerId: "chatgpt", status: "active", authMethod: "oauth", executionChannel: "direct-api", credentialEntryId: "fixture-credential" } });
    await db.modelProfile.create({ data: { providerId: "chatgpt", modelId, friendlyName: "Fixture model", summary: "Fixture", capabilityCategory: "general", costTier: "subscription", generatedBy: "fixture", bestFor: [], avoidFor: [] } });
    await db.providerCapacityStatus.create({ data: { providerId: "codex", state: "quota_resets_at", action: "retry_at", retryAt: new Date(Date.now() + 7 * 86400_000), safeSummary: "Fixture weekly forecast", confidence: "exact", source: "cli" } });
    await db.cliPoolStatus.create({ data: { adapterType: "codex-cli", providerId: "codex", rateLimitedAt: new Date(), resetAt: new Date(Date.now() + 7 * 86400_000) } });
  });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^quota_proof_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  const capture = async () => (await captureExecutionProofBinding(connectionId, modelId))!;
  const saved = () => db.providerCapacityStatus.findUniqueOrThrow({ where: { ownedAccountId: "fixture-account" } });

  it("qualifies exactly one model and preserves the broad forecast and CLI pool byte for byte", async () => {
    const quota = await db.providerCapacityStatus.findUniqueOrThrow({ where: { providerId: "codex" } });
    const poolBefore = await db.cliPoolStatus.findMany();
    const expected = await capture(); expect(expected).not.toBeNull();
    expect(await persistExecutionProof(expected, Date.now())).toBe(true);
    expect(await db.providerCapacityStatus.findUnique({ where: { providerId: "codex" } })).toEqual(quota);
    expect(await db.cliPoolStatus.findMany()).toEqual(poolBefore);
    const snapshot = await loadProviderCapacitySnapshots();
    const selected = { providerId: "chatgpt", providerConnectionId: connectionId, providerConnectionVersion: expected.binding.accountVersion, modelId };
    const local = { providerId: "local", modelId: "local" };
    expect(applyCapacitySoftExclusion({ endpoints: [selected, { ...selected, modelId: "different" }, { ...selected, providerId: "codex" }, local], capacityByProvider: snapshot, nowMs: Date.now() }).eligible).toEqual([selected, local]);
  });
  it.each(["pause", "credential", "model", "endpoint", "quota", "cli"])("refuses stale completion after a %s change", async change => {
    const expected = await capture();
    if (change === "pause") await db.aiProviderConnection.update({ where: { connectionId }, data: { status: "paused" } });
    if (change === "credential") {
      const credential = await db.credentialEntry.findUniqueOrThrow({ where: { id: "fixture-credential" } });
      await db.credentialEntry.update({ where: { id: credential.id }, data: { cachedToken: "replacement-synthetic-ciphertext", updatedAt: credential.updatedAt } });
    }
    if (change === "model") await db.modelProfile.update({ where: { providerId_modelId: { providerId: "chatgpt", modelId } }, data: { rawMetadataHash: "changed" } });
    if (change === "endpoint") await db.modelProvider.update({ where: { providerId: "chatgpt" }, data: { baseUrl: "https://changed.invalid" } });
    if (change === "quota") await db.providerCapacityStatus.update({ where: { providerId: "codex" }, data: { retryAt: new Date(Date.now() + 8 * 86400_000), updatedAt: new Date("2020-01-01") } });
    if (change === "cli") await db.cliPoolStatus.update({ where: { adapterType: "codex-cli" }, data: { resetAt: new Date(Date.now() + 8 * 86400_000) } });
    expect(await persistExecutionProof(expected, Date.now())).toBe(false);
    expect(await db.providerCapacityStatus.findUnique({ where: { ownedAccountId: "fixture-account" } })).toBeNull();
  });
  it("later quota generation invalidates a prior success even with an older timestamp", async () => {
    expect(await persistExecutionProof(await capture(), Date.now())).toBe(true);
    const proof = (await saved()).executionProof;
    await db.providerCapacityStatus.update({ where: { providerId: "codex" }, data: { retryAt: new Date(Date.now() + 9 * 86400_000), updatedAt: new Date("2020-01-01") } });
    expect(await readCurrentExecutionProof(connectionId, modelId, proof)).toBeNull();
  });
  it("serializes a concurrent pause before admitting an old completion", async () => {
    const expected = await capture();
    let unlock!: () => void, locked!: () => void;
    const release = new Promise<void>(resolve => { unlock = resolve; }), hasLock = new Promise<void>(resolve => { locked = resolve; });
    const pauser = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AiProviderConnection" WHERE "connectionId"=${connectionId} FOR UPDATE`;
      locked(); await release;
      await tx.aiProviderConnection.update({ where: { connectionId }, data: { status: "paused" } });
    });
    await hasLock;
    const attempt = persistExecutionProof(expected, Date.now()).catch(() => false);
    unlock(); await pauser;
    expect(await attempt).toBe(false);
    expect(await db.providerCapacityStatus.findUnique({ where: { ownedAccountId: "fixture-account" } })).toBeNull();
  });
  it("a newer quota committed concurrently remains effective regardless of commit ordering", async () => {
    const expected = await capture();
    await Promise.all([persistExecutionProof(expected, Date.now()).catch(() => false),
      db.providerCapacityStatus.update({ where: { providerId: "codex" }, data: { retryAt: new Date(Date.now() + 10 * 86400_000) } })]);
    const row = await db.providerCapacityStatus.findUnique({ where: { ownedAccountId: "fixture-account" } });
    expect(row ? await readCurrentExecutionProof(connectionId, modelId, row.executionProof) : null).toBeNull();
  });
  it("keeps the same proof age after ordinary success and invalidates it on an account failure", async () => {
    expect(await persistExecutionProof(await capture(), Date.now())).toBe(true);
    const proof = (await saved()).executionProof;
    const account = await db.aiProviderConnection.findUniqueOrThrow({ where: { connectionId }, include: { credentialEntry: true } });
    await clearProviderCapacityStatus({ providerId: "chatgpt", account: capacityAccountIdentity(account), source: "api" });
    expect((await saved()).executionProof).toEqual(proof);
    expect(await readCurrentExecutionProof(connectionId, modelId, proof)).not.toBeNull();
    await recordProviderCapacityStatus({ providerId: "chatgpt", account: capacityAccountIdentity(account), source: "api",
      classification: { state: "reauth_required", action: "reconnect", safeSummary: "Fixture sign-in required", confidence: "exact", isHumanActionRequired: true } });
    expect(await readCurrentExecutionProof(connectionId, modelId, (await saved()).executionProof)).toBeNull();
  });
  it("cannot persist after the commissioned job is disabled or displaced", async () => {
    const expected = await capture();
    await db.scheduledJob.create({ data: { jobId: "fixture-job", name: "Fixture", enabled: false, runCursor: "new-run" } });
    expect(await persistExecutionProof(expected, Date.now(), { jobId: "fixture-job", runCursor: "old-run" })).toBe(false);
  });
});
