import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
import { reassessmentBudgetFixture } from "../../test-support/reassessment-budget-fixture";
import { createEngagementPresentAdmission, currentEngagementPresentAssessment, readOutstandingEngagementReservations, checkEngagementPresentGenerationBudget, reconcileEngagementPresentObservation } from "./engagement-present-assessment";
import { issueEngagementPresentPolicy, engagementPresentPolicyDigest } from "./engagement-present-policy";
import { parseEngagementTaskBinding, type EngagementTaskBinding } from "./engagement-task-binding";
import { captureTaskExecutionFence } from "../shared/task-execution-fence";
// CI receives only the disposable database chosen by its governed runner.
// Outside CI, require an explicit fixture URL; never use ambient install credentials.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const schema = `review_engagement_${randomUUID().replaceAll("-", "")}`;
const tables = ["TaskRun", "TaskMessage", "TaskArtifact", "CoworkerEngagement", "ToolExecution", "Agent", "TokenUsage"];
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const binding: EngagementTaskBinding = { version: 1, engagementId: "CE-1FE20783", offerId: "fixture-offer",
  serviceId: "svc-ux-design-critique", providerAgentId: "ux-design-critic", actorAgentId: "fixture-actor", userId: "fixture-owner",
  workroomId: "WC-FIXTURE", stageKey: "accept", inputDigest: "a".repeat(64), artifactRef: { kind: "repo-blob-at-commit",
    repositoryFullName: "fixture/repo", commitSha: "b".repeat(40), path: "prototype.html", providerBlobId: "c".repeat(40) },
  visualEvidenceRef: { kind: "document-version", repositoryFullName: "fixture/repo", versionId: "immutable-fixture", valueDigest: "d".repeat(64) } };
const requestDigest = "e".repeat(64);
const oldProgress = { dispatch: { claimedAt: "held-original" }, executionUncertainty: { settlement: "unknown" }, attempt: 1 };
const oldMetadata = { engagementBinding: binding, requestDigest, trigger: "external-mcp", unknownSpend: "UNKNOWN" };
/** Actual SQL/production admission hooks with explicit synthetic authority and
 * configuration ports. No native provider, original review or Critic executes. */
describe.skipIf(!url)("finite original-engagement admission on PostgreSQL", () => {
  let f: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => { f = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  afterAll(async () => { await f?.close(); });
  beforeEach(async () => {
    for (const table of ["TaskMessage", "TaskArtifact"]) await f.pool.query(`DROP TRIGGER IF EXISTS "engagement_admission_failure" ON "${table}"`);
    await f.pool.query(`TRUNCATE ${tables.map(t => `"${t}"`).join(",")}`);
    await f.db.agent.create({ data: { id: "fixture-agent", agentId: "AGT-906", name: "synthetic-critic", displayName: "Synthetic Critic",
      kind: "specialist", tier: 2, type: "specialist" } });
    await f.db.taskRun.create({ data: { taskRunId: "TR-MCP-original", userId: binding.userId, currentAgentId: binding.providerAgentId,
      title: "Original synthetic held request", objective: "Original synthetic scope", routeContext: "/fixture", status: "input-required",
      progressPayload: json(oldProgress), a2aMetadata: json(oldMetadata) } });
    await f.db.coworkerEngagement.create({ data: { engagementId: binding.engagementId, offerId: binding.offerId, serviceId: binding.serviceId,
      providerAgentId: binding.providerAgentId, requestedByUserId: binding.userId, requestedByAgentId: binding.actorAgentId,
      requestedOutcome: "Original synthetic scope", status: "unavailable",
      metadata: json({ fulfillment: { binding, taskRunId: "TR-MCP-original", state: "unavailable" }, originalConsumption: "UNKNOWN" }) } });
  });
  function fixture(taskRunId: string) {
    const budget = reassessmentBudgetFixture({ agentId: "ux-design-critic", registryAgentId: "AGT-906",
      configuredPerTaskLimit: 20000, configuredTimeoutMs: 180000, configuredMaxOutputTokens: 8192 });
    const configuration = { configurationDigest: "1".repeat(64), apiRoot: "http://fixture.invalid", modelId: "fixture-model",
      budget, routingConfigDigest: "2".repeat(64), maxOutputTokens: 2048, minimumContextTokens: 16000, minimumCapabilities: null };
    const policy = issueEngagementPresentPolicy({ binding, originalTaskRunId: "TR-MCP-original", originalRequestDigest: requestDigest,
      originalFence: captureTaskExecutionFence(oldProgress, requestDigest)!, issuedAt: new Date().toISOString(),
      budgetConfigurationDigest: budget.configurationDigest, providerConfigurationDigest: configuration.configurationDigest,
      compositionDigest: "3".repeat(64), limits: { perTaskTokens: 20000, maxOutputTokens: 2048, timeoutMs: 180000,
        maxProviderStarts: 12, maxToolCalls: 40, maxSourceBytes: 250000, maxImageBytes: 4000000, maxImagePixels: 40000000 } });
    const policyDigest = engagementPresentPolicyDigest(policy);
    const present = parseEngagementTaskBinding({ ...binding, presentAssessment: { schemaVersion: 1,
      policyArtifactId: "ta-engagement-present-policy-" + "4".repeat(64), policyDigest,
      originalTaskRunId: policy.originalTaskRunId, originalRequestDigest: requestDigest } })!;
    const authority = vi.fn(async () => {});
    const scope = { policy, policyDigest, binding: present, configuration, context: { authorityDecisionId: "synthetic-native-decision" },
      assertNativeAuthority: authority };
    const input = { taskRunId, requestDigest: "5".repeat(64), threadId: "fixture-thread",
      token: { tokenId: `fixture-token-${taskRunId}`, userId: binding.userId, capability: "write" as const, source: "oauth" as const },
      parsed: { agentId: binding.providerAgentId, routeContext: "/fixture", title: "Synthetic present assessment",
        objective: "Original synthetic scope", prompt: "Complete immutable synthetic input", idempotencyKey: taskRunId,
        riskClass: "read" as const, engagementBinding: present, authorityScope: [] } };
    const ports = { validateTask: vi.fn(async () => ({})) as never, readConfiguration: vi.fn(async () => configuration) };
    const hooks = createEngagementPresentAdmission(scope, input, ports);
    return { scope, input, authority, ports, hooks };
  }
  async function admit(v: ReturnType<typeof fixture>) {
    return f.db.$transaction(async tx => {
      await v.hooks.admissionGuard(tx);
      const run = await tx.taskRun.create({ data: { taskRunId: v.input.taskRunId, userId: binding.userId,
        currentAgentId: binding.providerAgentId, title: v.input.parsed.title, objective: v.input.parsed.objective,
        routeContext: "/fixture", status: "working", a2aMetadata: json({ engagementBinding: v.scope.binding,
          requestDigest: v.input.requestDigest }), authorityScope: [] } });
      await v.hooks.afterTaskCreated(tx, run); return run;
    }, { isolationLevel: "Serializable" });
  }
  it("commits one policy/start/immutable input and preserves the exact held original", async () => {
    const prior = await f.db.taskRun.findUnique({ where: { taskRunId: "TR-MCP-original" } });
    const v = fixture("TR-MCP-present"); const run = await admit(v);
    expect(await f.db.taskArtifact.count()).toBe(2); expect(await f.db.taskMessage.count({ where: { taskRunId: run.id } })).toBe(1);
    expect((await f.db.coworkerEngagement.findUnique({ where: { engagementId: binding.engagementId } }))?.metadata)
      .toMatchObject({ fulfillment: { taskRunId: "TR-MCP-original", binding }, presentAssessment: { taskRunId: run.taskRunId, historicalConsumption: "UNKNOWN" } });
    expect(canonicalJson(await f.db.taskRun.findUnique({ where: { taskRunId: "TR-MCP-original" } }))).toBe(canonicalJson(prior));
    expect(currentEngagementPresentAssessment()).toBeNull(); // SQL fixtures cannot mint an executable request.
  });
  it("admits only one concurrent cross-family candidate and refuses later alternate keys", async () => {
    const results = await Promise.allSettled([admit(fixture("TR-MCP-family-left")), admit(fixture("TR-MCP-family-right"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await f.db.taskRun.count()).toBe(2); expect(await f.db.taskArtifact.count()).toBe(2); expect(await f.db.taskMessage.count()).toBe(1);
    await expect(admit(fixture("TR-MCP-another-family-key"))).rejects.toThrow("engagement-present-already-allocated");
    expect(await f.db.taskRun.count()).toBe(2);
  });
  it.each(["TaskArtifact", "TaskMessage"])("rolls back the whole candidate if %s persistence fails", async table => {
    await f.pool.query(`CREATE OR REPLACE FUNCTION engagement_admission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic engagement admission failure'; END $$`);
    await f.pool.query(`CREATE TRIGGER "engagement_admission_failure" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION engagement_admission_failure()`);
    await expect(admit(fixture("TR-MCP-rollback"))).rejects.toThrow("synthetic engagement admission failure");
    expect(await f.db.taskRun.count()).toBe(1); expect(await f.db.taskArtifact.count()).toBe(0); expect(await f.db.taskMessage.count()).toBe(0);
    const ce = await f.db.coworkerEngagement.findUnique({ where: { engagementId: binding.engagementId } });
    expect(ce?.metadata).not.toHaveProperty("presentAssessment");
  });
  it("refuses current DENY or changed configuration before creating a candidate", async () => {
    const denied = fixture("TR-MCP-denied"); denied.authority.mockRejectedValue(new Error("current-native-DENY"));
    await expect(admit(denied)).rejects.toThrow("current-native-DENY");
    const changed = fixture("TR-MCP-changed"); changed.ports.readConfiguration.mockResolvedValue({ ...changed.scope.configuration, configurationDigest: "0".repeat(64) });
    await expect(admit(changed)).rejects.toThrow("engagement-present-configuration-changed");
    expect(await f.db.taskRun.count()).toBe(1); expect(await f.db.taskArtifact.count()).toBe(0);
  });
  async function reservation(agentId: string, createdAt: Date, amount: number, operation = "generation", success = false) {
    return f.db.toolExecution.create({ data: { threadId: "fixture-thread", userId: binding.userId, agentId,
      toolName: "engagement_present_capture", executionMode: "finite-engagement-capture", success, createdAt,
      parameters: json({ operation, tokenReservation: { reservedTokens: amount } }), result: { state: "synthetic-reserved" } } });
  }
  it("retains unresolved generation upper bounds across midnight and both canonical aliases", async () => {
    const day = new Date(); day.setUTCHours(0,0,0,0);
    await reservation("ux-design-critic", new Date(day.getTime() - 1000), 19000);
    await reservation("AGT-906", new Date(day.getTime() + 1000), 17000);
    await reservation("AGT-906", new Date(), 999999, "configuration");
    await reservation("AGT-906", new Date(), 5000, "generation", true);
    expect(await readOutstandingEngagementReservations(f.db, "AGT-906")).toEqual({ reservedTokens: 36000, reservationCount: 2 });
  });
  it("holds malformed, unsafe-total or oversized unresolved ledgers instead of silently dropping reservations", async () => {
    await reservation("AGT-906", new Date(), -1);
    await expect(readOutstandingEngagementReservations(f.db, "AGT-906")).rejects.toThrow("engagement-present-outstanding-consumption-unproven");
    await f.db.toolExecution.deleteMany();
    await reservation("AGT-906", new Date(), Number.MAX_SAFE_INTEGER);
    await reservation("ux-design-critic", new Date(), 1);
    await expect(readOutstandingEngagementReservations(f.db, "AGT-906")).rejects.toThrow("engagement-present-outstanding-consumption-unproven");
    await f.db.toolExecution.deleteMany();
    await f.db.toolExecution.createMany({ data: Array.from({ length: 1001 }, (_, i) => ({ id: `bounded-ledger-${i}`, threadId: "fixture-thread",
      userId: binding.userId, agentId: "AGT-906", toolName: "engagement_present_capture", executionMode: "finite-engagement-capture", success: false,
      parameters: { operation: "generation", tokenReservation: { reservedTokens: 1 } }, result: {} })) });
    await expect(readOutstandingEngagementReservations(f.db, "AGT-906")).rejects.toThrow("engagement-present-outstanding-ledger-overflow");
  });

  it("serializes concurrent generation claims across aliases while retaining the previous day's UNKNOWN reservation", async () => {
    const day = new Date(); day.setUTCHours(0,0,0,0);
    await reservation("ux-design-critic", new Date(day.getTime() - 1000), 10000);
    const budget = reassessmentBudgetFixture({ agentId: "ux-design-critic", registryAgentId: "AGT-906",
      configuredPerTaskLimit: 20000, configuredDailyLimit: 30000, configuredMaxOutputTokens: 2048 });
    const claim = (agentId: string) => f.db.$transaction(async tx => {
      const facts = await checkEngagementPresentGenerationBudget(tx, { budget, reservation: {
        bodySha256: "a".repeat(64), inputTokens: 17000, maxOutputTokens: 2000, reservedTokens: 19000 } });
      await tx.toolExecution.create({ data: { threadId: "fixture-thread", userId: binding.userId, agentId,
        toolName: "engagement_present_capture", executionMode: "finite-engagement-capture", success: false,
        parameters: json({ operation: "generation", budgetOwnerAgentId: "AGT-906", tokenReservation: { reservedTokens: 19000 }, budgetAccounting: facts }), result: {} } });
      return facts;
    }, { isolationLevel: "Serializable" });
    const outcomes = await Promise.allSettled([claim("AGT-906"), claim("ux-design-critic")]);
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await readOutstandingEngagementReservations(f.db, "AGT-906")).toEqual({ reservedTokens: 29000, reservationCount: 2 });
    const accepted = outcomes.find(r => r.status === "fulfilled");
    if (accepted?.status === "fulfilled") expect(accepted.value).toMatchObject({ originalHistoricalConsumption: "UNKNOWN", dailyHeadroomProven: false });
  });
  it("makes an expired unacknowledged assessment visibly held without replay or changing the original", async () => {
    const v = fixture("TR-MCP-expired"); const run = await admit(v);
    const ce = await f.db.coworkerEngagement.findUnique({ where: { engagementId: binding.engagementId } });
    const association = (ce!.metadata as Record<string, Record<string, unknown>>).presentAssessment!;
    const deadline = new Date(Date.now() - 1000).toISOString();
    await f.db.coworkerEngagement.update({ where: { engagementId: binding.engagementId },
      data: { metadata: json({ ...(ce!.metadata as object), presentAssessment: { ...association, deadlineAt: deadline } }) } });
    await f.db.taskRun.update({ where: { id: run.id }, data: { progressPayload: { engagementPresent: { deadlineAt: deadline } } } });
    await reconcileEngagementPresentObservation(binding.engagementId, f.db);
    await reconcileEngagementPresentObservation(binding.engagementId, f.db);
    expect((await f.db.taskRun.findUnique({ where: { id: run.id } }))?.status).toBe("input-required");
    const latest = await f.db.coworkerEngagement.findUnique({ where: { engagementId: binding.engagementId } });
    expect(latest?.metadata).toMatchObject({ fulfillment: { taskRunId: "TR-MCP-original" }, presentAssessment: { state: "held", resumable: false } });
    expect(await f.db.taskRun.count()).toBe(2); expect(await f.db.toolExecution.count()).toBe(0);
    expect((await f.db.taskRun.findUnique({ where: { taskRunId: "TR-MCP-original" } }))?.progressPayload).toEqual(oldProgress);
  });
  it("projects cancellation without reopening or rewriting the cancelled TaskRun", async () => {
    const run = await admit(fixture("TR-MCP-cancelled"));
    await f.db.taskRun.update({ where: { id: run.id }, data: { status: "canceled" } });
    await reconcileEngagementPresentObservation(binding.engagementId, f.db);
    expect((await f.db.taskRun.findUnique({ where: { id: run.id } }))?.status).toBe("canceled");
    expect((await f.db.coworkerEngagement.findUnique({ where: { engagementId: binding.engagementId } }))?.metadata)
      .toMatchObject({ presentAssessment: { state: "cancelled", taskStatus: "canceled", resumable: false } });
  });
});
