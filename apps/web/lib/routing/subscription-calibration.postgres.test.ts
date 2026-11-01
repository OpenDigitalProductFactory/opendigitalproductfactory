import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: undefined as unknown as PrismaClient, call: vi.fn() }));
vi.mock("@dpf/db", async () => {
  const { Prisma } = await import("../../../../packages/db/generated/client/client");
  return { Prisma, prisma: new Proxy({}, { get: (_, key) => {
    const value = state.db[key as keyof PrismaClient]; return typeof value === "function" ? value.bind(state.db) : value;
  } }) };
});
vi.mock("@/lib/ai-inference", async () => ({ ...(await import("./inference-error")), callProvider: state.call }));
import { captureExecutionProofBinding, persistExecutionProof } from "./provider-capacity/execution-proof.server";
import { commissionSubscriptionCalibration, calibrationCorpus, validateCalibrationCommission } from "./subscription-calibration-admission";
import { runSubscriptionCalibration } from "./subscription-calibration-execution";
import { assertGovernedInferenceAuthority } from "./governed-inference-deadline";

const leased = process.env.DPF_NONPROD_LEASE_ID && process.env.DATABASE_URL
  && /^\/dpf_local_ci_\d+$/.test(new URL(process.env.DATABASE_URL).pathname) ? process.env.DATABASE_URL : undefined;
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
const schema = `calibration_test_${randomUUID().replaceAll("-", "")}`;
const tables = ["ModelProvider", "CredentialEntry", "AiProviderConnection", "ModelProfile", "ProviderCapacityStatus", "CliPoolStatus",
  "ScheduledJob", "EndpointTestRun", "User", "UserGroup", "PlatformRole", "Principal", "PrincipalAlias"];
const modelId = "fixture-selected", connectionId = "provider-default-chatgpt", userId = "fixture-operator";

describe.skipIf(!url)("owned calibration on isolated leased PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url }); await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=10000`, max: 6 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) }); state.db = db;
    // Schema structure only; never copy install accounts, secrets, or business data.
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  });
  beforeEach(async () => {
    state.call.mockReset();
    await pool.query(`TRUNCATE ${tables.map(t => `"${t}"`).join(", ")}`);
    await db.user.create({ data: { id: userId, email: "fixture@example.invalid", passwordHash: "synthetic-unusable", isSuperuser: true } });
    await db.principal.create({ data: { id: "fixture-principal", principalId: "PRN-calibration-fixture", kind: "human", displayName: "Fixture operator" } });
    await db.principalAlias.create({ data: { principalId: "fixture-principal", aliasType: "user", issuer: "", aliasValue: userId } });
    await db.modelProvider.create({ data: { providerId: "chatgpt", name: "Fixture", status: "active", families: [], authMethod: "oauth2_authorization_code", baseUrl: "https://fixture.invalid/backend-api" } });
    await db.credentialEntry.create({ data: { id: "fixture-credential", status: "ok", cachedToken: "synthetic-ciphertext" } });
    await db.aiProviderConnection.create({ data: { id: "fixture-account", connectionId, providerId: "chatgpt", status: "active", authMethod: "oauth", executionChannel: "direct-api", credentialEntryId: "fixture-credential" } });
    await db.modelProfile.create({ data: { providerId: "chatgpt", modelId, friendlyName: "Fixture", summary: "Fixture", capabilityCategory: "general", costTier: "subscription",
      generatedBy: "fixture", bestFor: [], avoidFor: [], modelStatus: "active", conversational: 73, evalCount: 4, profileConfidence: "high" } });
    const captured = await captureExecutionProofBinding(connectionId, modelId); expect(captured).not.toBeNull();
    expect(await persistExecutionProof(captured!, Date.now())).toBe(true);
    state.call.mockImplementation(async (...args) => {
      await assertGovernedInferenceAuthority();
      const job = await db.scheduledJob.findFirstOrThrow();
      const journal = job.metadata as any, attempt = journal.attempts.at(-1);
      expect(attempt.disposition).toBe("unknown"); expect(attempt.cap).toBe(args[5].maxTokens);
      const support = attempt.testId === "output-bound-support";
      return { content: "A response", outputTokens: support ? 32 : 10, inputTokens: 10, inferenceMs: 1,
        finishReason: support ? "max_output_tokens" : "completed", truncated: support, responseId: `response-${state.call.mock.calls.length}` };
    });
  });
  afterAll(async () => {
    await db?.$disconnect(); await pool?.end();
    if (admin && /^calibration_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  const commission = () => commissionSubscriptionCalibration(userId, "chatgpt", modelId);
  const execute = (runId: string) => runSubscriptionCalibration({ runId, endpointId: "chatgpt", modelId, userId });

  it("admits exactly one concurrent commission and creates no competing run", async () => {
    const results = await Promise.allSettled([commission(), commission()]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.endpointTestRun.count()).toBe(1); expect(state.call).not.toHaveBeenCalled();
  });
  it("reserves before dispatch and persists genuine partial scope without promoting confidence or the full-model count", async () => {
    const c = await commission(); await execute(c.runId);
    const model = await db.modelProfile.findFirstOrThrow();
    expect(model).toMatchObject({ profileSource: "evaluated", evalCount: 4, profileConfidence: "high", conversational: 73 });
    const run = await db.endpointTestRun.findUniqueOrThrow({ where: { runId: c.runId } });
    expect(run).toMatchObject({ status: "incomplete", avgScore: null, results: { qualityWritesApplied: true,
      measurementScope: { fullCohortVerified: false, unverifiedDimensions: ["conversational"] } } });
  });
  it("dispatches only one corpus under concurrent worker delivery", async () => {
    const c = await commission();
    await Promise.allSettled([execute(c.runId), execute(c.runId)]);
    expect(state.call).toHaveBeenCalledTimes(1 + calibrationCorpus().filter(t => t.scoring !== "orchestrator").length);
    expect(await db.endpointTestRun.count()).toBe(1);
    expect((await db.endpointTestRun.findUniqueOrThrow({ where: { runId: c.runId } })).results).toMatchObject({ qualityWritesApplied: true });
  });
  it("keeps lost-result work fenced across queue redelivery, force and the former ten-minute cutoff", async () => {
    const c = await commission(); state.call.mockRejectedValue(new Error("Remote result lost"));
    await execute(c.runId);
    await db.endpointTestRun.update({ where: { runId: c.runId }, data: { startedAt: new Date(0) } });
    await expect(execute(c.runId)).resolves.toMatchObject({ skipped: true });
    await expect(commission()).rejects.toThrow("unresolved");
    expect(state.call).toHaveBeenCalledOnce();
    expect((await db.modelProfile.findFirstOrThrow()).profileSource).not.toBe("evaluated");
  });
  it.each(["credential", "ownership", "operator", "model"])("rejects changed %s before worker dispatch", async changed => {
    const c = await commission();
    if (changed === "credential") await db.credentialEntry.update({ where: { id: "fixture-credential" }, data: { status: "revoked" } });
    if (changed === "ownership") await db.aiProviderConnection.update({ where: { connectionId }, data: { organizationId: "foreign" } });
    if (changed === "operator") await db.user.update({ where: { id: userId }, data: { isSuperuser: false } });
    if (changed === "model") await db.modelProfile.updateMany({ data: { catalogHash: "changed" } });
    expect(await validateCalibrationCommission(c)).toBe(false);
    await expect(execute(c.runId)).rejects.toThrow("stale"); expect(state.call).not.toHaveBeenCalled();
  });
  it("rejects final projection after credential revocation between the last observation and persistence", async () => {
    const c = await commission(), original = state.call.getMockImplementation()!;
    const count = 1 + calibrationCorpus().filter(t => t.scoring !== "orchestrator").length;
    state.call.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (state.call.mock.calls.length === count) await db.credentialEntry.update({ where: { id: "fixture-credential" }, data: { status: "revoked" } });
      return result;
    });
    const before = await db.modelProfile.findFirstOrThrow(); await execute(c.runId);
    expect(await db.modelProfile.findFirstOrThrow()).toEqual(before);
    expect((await db.endpointTestRun.findUniqueOrThrow({ where: { runId: c.runId } })).results).toMatchObject({ qualityWritesApplied: false });
  });
});
