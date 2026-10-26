import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { createReviewPostgresFixture } from "../test-support/review-postgres-fixture";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { lockInitiativeReviewCreationSubject } from "./mcp-task-review-reassessment";
import { issueOriginalReviewRecoveryTarget } from "./mcp-task-review-recovery";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";

// These inventory cases must stop before result collection. Keep a regression
// from reaching a global database outside the explicitly isolated SQL fixture.
vi.mock("./mcp-task-original-result", () => ({ readOriginalReviewResult: () => {
  throw new Error("Inventory refusal must precede original result collection");
} }));

// Only a governed isolated SQL slot may execute these tests. They create no
// provider request, real assessment, source approval or native receipt.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_creation_${randomUUID().replaceAll("-", "")}`;
const tables = ["BacklogItem", "TaskRun", "TaskMessage", "WorkCapsule"];
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const binding: InitiativeReviewBinding = { itemId: "BI-285EF102", gate: "design-spec", writerToolName: "record_initiative_design_review",
  expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repository",
    commitSha: "a".repeat(40), providerBlobId: "b".repeat(40), path: "fixture.md" } };
const relation = { schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-fixture", policyDigest: "c".repeat(64),
  originalTaskRunId: "TR-fixture-original", originalRequestDigest: "d".repeat(64), predecessorTaskRunIds: ["TR-fixture-original"], authorityArtifact: binding.artifactRef };
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe.skipIf(!url)("ordinary review creation exclusion on PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => { fixture = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    await fixture.pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`);
    await fixture.db.backlogItem.createMany({ data: [binding.itemId, "BI-OTHER"].map(itemId => ({ itemId, title: "Synthetic subject", status: "open", type: "product" })) });
  });
  function accepted(taskRunId: string, mode: string) {
    const parsed = parseRemoteTaskSubmitParams({ agentId: "fixture-reviewer", routeContext: "/build", title: "Synthetic review",
      objective: "Review immutable fixture", prompt: "Review immutable fixture", riskClass: "bounded-write", collaborationKind: "handoff",
      idempotencyKey: taskRunId, authorityScope: [`backlog-item:${binding.itemId}`, "tool:read_source_at_version", "tool:record_initiative_design_review"],
      initiativeReviewBinding: { ...binding, ...(mode === "present" ? { presentReassessment: relation } : {}) } });
    if (typeof parsed === "string") throw new Error(parsed);
    const id = randomUUID();
    const progress = mode === "unknown" ? { executionUncertainty: { schemaVersion: 1, settlement: "unknown" } }
      : mode === "legacy" || mode === "known-wait" ? { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", resumeMode: "same-taskrun",
        writerToolName: binding.writerToolName, attempt: 1, observedAt: new Date().toISOString(), ...(mode === "known-wait" ? { dispatchContract: "required-tool-call" } : {}) } }
        : mode === "quarantine" ? { reassessmentQuarantine: null } : {};
    const metadata = { trigger: "external-mcp", requestedAgentId: parsed.agentId, requestedThreadId: null, requestObjective: parsed.objective,
      collaborationKind: parsed.collaborationKind, idempotencyKey: parsed.idempotencyKey, riskClass: parsed.riskClass,
      requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(parsed), initiativeReviewBinding: parsed.initiativeReviewBinding };
    if (mode === "malformed") Object.assign(metadata.initiativeReviewBinding!, { futureAuthority: true });
    return { row: { id, taskRunId, userId: "different-fixture-owner", currentAgentId: parsed.agentId, routeContext: parsed.routeContext,
      title: parsed.title, objective: parsed.objective, status: mode === "known-wait" ? "input-required" : "canceled", progressPayload: json(progress), authorityScope: json(parsed.authorityScope), a2aMetadata: json(metadata) },
    message: { id: randomUUID(), messageId: randomUUID(), taskRunId: id, contextId: "fixture-context", role: "user",
      parts: json([{ type: "message", text: parsed.prompt }]), referenceTaskIds: [] as string[] } };
  }
  async function insert(tx: Prisma.TransactionClient, value: ReturnType<typeof accepted>) {
    await tx.taskRun.create({ data: value.row }); await tx.taskMessage.create({ data: value.message });
  }
  const transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => fixture.db.$transaction(fn, { isolationLevel: "ReadCommitted", timeout: 10_000 });
  const aliasRoot = "review-sql-alias-inventory";
  const aliasUser = "fixture-alias-owner";
  const currentReviewer = "fixture-reviewer-current";
  const currentFamily = "oauth-family:sql-current";
  const aliasBinding: InitiativeReviewBinding = { ...binding, workroomRef: { kind: "workroom-head", workroomId: "WC-FIXTURE",
    repositoryFullName: "fixture/repository", branchName: "codex/sql-alias-inventory", headSha: "a".repeat(40) } };
  const aliasKey = (reviewer: string, root = aliasRoot) => `${root}:reviewer:${createHash("sha256").update(reviewer).digest("hex")}`;
  function alias(key: string, family: string, reviewer: string, status = "input-required") {
    const parsed = parseRemoteTaskSubmitParams({ agentId: reviewer, routeContext: "/build", title: "Synthetic alias review",
      objective: "Review exact immutable alias fixture", prompt: "Review exact immutable alias fixture", riskClass: "bounded-write",
      collaborationKind: "handoff", idempotencyKey: key,
      authorityScope: [`backlog-item:${binding.itemId}`, "tool:read_source_at_version", "tool:record_initiative_design_review"],
      initiativeReviewBinding: aliasBinding });
    if (typeof parsed === "string") throw new Error(parsed);
    return { id: randomUUID(), taskRunId: deterministicExternalTaskRunId(family, key), userId: aliasUser,
      currentAgentId: reviewer, routeContext: parsed.routeContext, title: parsed.title, objective: parsed.objective, status,
      authorityScope: json(parsed.authorityScope), progressPayload: json({ terminalWriterWait: { schemaVersion: 1,
        kind: "missing-terminal-writer", resumeMode: "same-taskrun", writerToolName: binding.writerToolName,
        attempt: 1, observedAt: new Date().toISOString() } }),
      a2aMetadata: json({ trigger: "external-mcp", apiTokenId: "fixture-alias-token", tokenSource: "oauth", tokenCapability: "write",
        taskAuthorityKey: family, requestedAgentId: reviewer, requestedThreadId: null, requestObjective: parsed.objective,
        collaborationKind: parsed.collaborationKind, idempotencyKey: key, riskClass: parsed.riskClass,
        requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(parsed), initiativeReviewBinding: parsed.initiativeReviewBinding }) };
  }
  function readAliases() {
    return transaction(tx => issueOriginalReviewRecoveryTarget({ packet: { targetAgent: currentReviewer,
      questionPacketSummary: "Synthetic alias review", objective: "Review exact immutable alias fixture",
      requestKey: aliasKey(currentReviewer), initiativeReviewBinding: aliasBinding },
      userId: aliasUser, actingAgentId: "AGT-EXT-CODEX", taskAuthorityKey: currentFamily }, tx));
  }
  const aliasSnapshot = () => fixture.db.taskRun.findMany({ orderBy: { taskRunId: "asc" },
    select: { taskRunId: true, status: true, a2aMetadata: true, progressPayload: true, authorityScope: true } });
  async function createOrdinary(target = binding) {
    return transaction(async tx => {
      await lockInitiativeReviewCreationSubject(tx, target);
      return tx.taskRun.create({ data: { taskRunId: "TR-fixture-new", userId: "fixture-new-owner", currentAgentId: "fixture-reviewer",
        title: "Synthetic ordinary allocation", objective: "No provider execution", status: "working" } });
    });
  }
  it.each(["present", "quarantine", "unknown", "legacy", "known-wait", "malformed"])("refuses a fresh ordinary key against %s accepted history across owners and terminal states", async mode => {
    await transaction(tx => insert(tx, accepted("TR-fixture-original", mode)));
    await expect(createOrdinary()).rejects.toMatchObject({ code: mode === "malformed" ? "reassessment-lineage-unproven" : "reassessment-original-recovery-required" });
    expect(await fixture.db.taskRun.count()).toBe(1);
  });
  it.each(["gate", "artifact", "item", "plan"])("preserves unrelated ordinary %s creation", async changed => {
    await transaction(tx => insert(tx, accepted("TR-fixture-original", "unknown")));
    const target: InitiativeReviewBinding = changed === "gate" ? { ...binding, gate: "spec-approval" }
      : changed === "artifact" ? { ...binding, artifactRef: { ...binding.artifactRef, providerBlobId: "e".repeat(40) } as InitiativeReviewBinding["artifactRef"] }
        : changed === "item" ? { ...binding, itemId: "BI-OTHER" } : { ...binding, gate: "plan-review" };
    await expect(createOrdinary(target)).resolves.toMatchObject({ taskRunId: "TR-fixture-new" });
    expect(await fixture.db.taskRun.count()).toBe(2);
  });
  it("sees a candidate committed while the ordinary creator waits on the subject lock", async () => {
    const inserted = signal(), release = signal(); let ordinary: ReturnType<typeof createOrdinary> | undefined;
    const candidate = transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "itemId" = ${binding.itemId} FOR UPDATE`;
      await insert(tx, accepted("TR-fixture-original", "present")); inserted.resolve(); await release.promise;
    });
    try {
      await inserted.promise; ordinary = createOrdinary(); void ordinary.catch(() => undefined);
      const until = Date.now() + 3_000; let waiting = false;
      while (Date.now() < until) {
        const rows = await fixture.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%BacklogItem%'", [schema]);
        if (rows.rowCount) { waiting = true; break; }
        await new Promise(done => setTimeout(done, 10));
      }
      expect(waiting).toBe(true); release.resolve(); await candidate;
      await expect(ordinary).rejects.toMatchObject({ code: "reassessment-original-recovery-required" });
      expect(await fixture.db.taskRun.count()).toBe(1);
    } finally { release.resolve(); await candidate; await ordinary?.catch(() => undefined); }
  }, 15000);
  it("does not acquire another task lock beneath its subject lock", async () => {
    const value = accepted("TR-fixture-original", "unknown"); await transaction(tx => insert(tx, value));
    const blocker = await fixture.pool.connect(); await blocker.query("BEGIN");
    try {
      await blocker.query('SELECT "id" FROM "TaskRun" WHERE "id"=$1 FOR UPDATE', [value.row.id]);
      await expect(createOrdinary()).rejects.toMatchObject({ code: "reassessment-original-recovery-required" });
      expect(await fixture.db.taskRun.count()).toBe(1);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });

  it("inventories coexisting unresolved unsuffixed and scoped keys across OAuth families with the real JSON query", async () => {
    await fixture.db.taskRun.createMany({ data: [alias(aliasRoot, "oauth-family:sql-original", currentReviewer),
      alias(aliasKey(currentReviewer), currentFamily, currentReviewer)] });
    const before = await aliasSnapshot();
    await expect(readAliases()).resolves.toEqual({ kind: "refused", reason: "original-review-ambiguous" });
    expect(await aliasSnapshot()).toEqual(before);
  });

  it("finds unresolved scoped aliases when neither belongs to the current reviewer or family", async () => {
    await fixture.db.taskRun.createMany({ data: [
      alias(aliasKey("fixture-reviewer-first"), "oauth-family:sql-first", "fixture-reviewer-first"),
      alias(aliasKey("fixture-reviewer-second"), "oauth-family:sql-second", "fixture-reviewer-second"),
    ] });
    const before = await aliasSnapshot();
    await expect(readAliases()).resolves.toEqual({ kind: "refused", reason: "original-review-ambiguous" });
    expect(await aliasSnapshot()).toEqual(before);
  });

  it("does not hide a legacy unsuffixed original when both reviewer and OAuth family change", async () => {
    const original = alias(aliasRoot, "oauth-family:sql-original", "fixture-reviewer-original");
    await fixture.db.taskRun.create({ data: original });
    const before = await aliasSnapshot();
    await expect(readAliases()).resolves.toEqual({ kind: "refused", reason: "original-review-not-safely-resumable" });
    expect(await aliasSnapshot()).toEqual(before);
  });

  it("does not let a completed current scoped alias mask an unresolved legacy original", async () => {
    await fixture.db.taskRun.createMany({ data: [
      alias(aliasKey(currentReviewer), currentFamily, currentReviewer, "completed"),
      alias(aliasRoot, "oauth-family:sql-original", "fixture-reviewer-original"),
    ] });
    const before = await aliasSnapshot();
    await expect(readAliases()).resolves.toEqual({ kind: "refused", reason: "original-review-not-safely-resumable" });
    expect(await aliasSnapshot()).toEqual(before);
  });

  it("fails closed on more than 500 matching aliases before selecting an original", async () => {
    await fixture.db.taskRun.createMany({ data: Array.from({ length: 501 }, (_, index) => {
      const reviewer = `fixture-reviewer-overflow-${index}`;
      return alias(aliasKey(reviewer), "oauth-family:sql-original", reviewer);
    }) });
    const before = await aliasSnapshot();
    expect(before).toHaveLength(501);
    await expect(readAliases()).resolves.toEqual({ kind: "refused", reason: "original-review-history-limit" });
    expect(await aliasSnapshot()).toEqual(before);
  });

  it("does not inventory a distinct original-key namespace as a reviewer alias", async () => {
    await fixture.db.taskRun.create({ data: alias(aliasKey(currentReviewer, `${aliasRoot}-unrelated`), currentFamily, currentReviewer) });
    const before = await aliasSnapshot();
    await expect(readAliases()).resolves.toEqual({ kind: "none" });
    expect(await aliasSnapshot()).toEqual(before);
  });
});
