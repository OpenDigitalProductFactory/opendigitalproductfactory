import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@dpf/db";
import { createReviewPostgresFixture } from "../test-support/review-postgres-fixture";
import { parseInitiativeReviewBinding, type InitiativeReviewBinding } from "./mcp-task-review-contract";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { collectReassessmentLineage, lockReassessmentLineage, revalidateReassessmentLineage, type ReassessmentLineageInput } from "./mcp-task-reassessment-lineage";

// Only the governed shared SQL runner supplies an isolated database. There is
// no provider, native request, parent assessment or general DATABASE_URL use.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_lineage_${randomUUID().replaceAll("-", "")}`;
const tables = ["BacklogItem", "TaskRun", "TaskMessage", "WorkCapsule"];
const binding: InitiativeReviewBinding = parseInitiativeReviewBinding({ itemId: "BI-285EF102", gate: "design-spec",
  writerToolName: "record_initiative_design_review", expectedCurrentBaselineId: null,
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repository", path: "fixture.md", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) } })!;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe.skipIf(!url)("bounded review lineage on PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => { fixture = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => { await fixture.pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`); });

  function data(taskRunId: string, gate = "design-spec", userId = "fixture-owner") {
    const accepted = { agentId: `fixture-reviewer-${taskRunId}`, routeContext: "/build", title: "Synthetic lineage review", objective: "Synthetic exact review",
      prompt: "Synthetic exact review", riskClass: "bounded-write" as const, idempotencyKey: taskRunId,
      authorityScope: [`backlog-item:${binding.itemId}`, "tool:record_initiative_design_review", "tool:read_source_at_version"],
      initiativeReviewBinding: parseInitiativeReviewBinding({ ...binding, gate })! };
    const id = randomUUID(), requestDigest = remoteTaskRequestDigest(accepted);
    return { id, taskRunId, requestDigest, row: { id, taskRunId, userId, currentAgentId: accepted.agentId, routeContext: accepted.routeContext,
      title: accepted.title, objective: accepted.objective, status: "completed", authorityScope: json(accepted.authorityScope),
      a2aMetadata: json({ trigger: "external-mcp", requestedAgentId: accepted.agentId, idempotencyKey: accepted.idempotencyKey, riskClass: accepted.riskClass,
        requestObjective: accepted.objective, requestDigestVersion: 2, requestDigest, initiativeReviewBinding: accepted.initiativeReviewBinding }) },
    message: { id: randomUUID(), messageId: randomUUID(), taskRunId: id, contextId: "fixture-context", role: "user", parts: json([{ type: "message", text: accepted.prompt }]), referenceTaskIds: [] as string[] } };
  }
  async function create(tx: Prisma.TransactionClient, taskRunId: string, gate = "design-spec", userId = "fixture-owner") {
    const value = data(taskRunId, gate, userId); await tx.taskRun.create({ data: value.row }); await tx.taskMessage.create({ data: value.message }); return value;
  }
  async function setup(): Promise<ReassessmentLineageInput> {
    await fixture.db.backlogItem.createMany({ data: [{ id: "fixture-subject", itemId: binding.itemId, title: "Synthetic subject", status: "open", type: "product", workType: "feature", scopeKind: "platform" },
      { id: "fixture-authorization", itemId: "BI-7906C73E", title: "Synthetic authorization", status: "open", type: "product", workType: "feature", scopeKind: "platform" }] });
    const originals = await fixture.db.$transaction(async tx => [await create(tx, "TR-fixture-original-design"), await create(tx, "TR-fixture-original-approval", "spec-approval")]);
    return { binding, organizationId: null, originals: originals.map(({ taskRunId, requestDigest }) => ({ taskRunId, requestDigest })) };
  }
  const itemIds = [binding.itemId, "BI-7906C73E"];
  async function waitForBlocked(table: "TaskRun" | "BacklogItem") {
    const until = Date.now() + 3_000;
    while (Date.now() < until) {
      const rows = await fixture.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2", [schema, `%${table}%`]);
      if (rows.rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Synthetic producer never reached the ${table} lock`);
  }
  const transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => fixture.db.$transaction(fn, { timeout: 10_000 });

  it("includes real persisted acceptance across both gates, humans, states and multiple pages", async () => {
    const input = await setup(), extra = Array.from({ length: 53 }, (_, index) => data(`TR-fixture-page-${index}`, index % 2 ? "design-spec" : "spec-approval", "fixture-other-owner"));
    await fixture.db.taskRun.createMany({ data: extra.map(value => ({ ...value.row, status: "canceled" })) });
    await fixture.db.taskMessage.createMany({ data: extra.map(value => value.message) });
    const snapshot = await transaction(tx => collectReassessmentLineage(tx, input));
    expect(snapshot.rows).toHaveLength(55); expect(snapshot.rows.filter(row => row.userId === "fixture-other-owner")).toHaveLength(53);
    expect(snapshot.rows.filter(row => row.status === "canceled")).toHaveLength(53);
  });
  it("aborts a refreshed membership change before any synthetic admission effect", async () => {
    const input = await setup(), snapshot = await transaction(tx => collectReassessmentLineage(tx, input)); let admitted = false;
    await transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "itemId" = ${binding.itemId} FOR UPDATE`;
      await create(tx, "TR-fixture-new-family");
    });
    await expect(transaction(async tx => {
      const locked = await lockReassessmentLineage(tx, snapshot, itemIds); await revalidateReassessmentLineage(tx, locked); admitted = true;
    })).rejects.toMatchObject({ code: "reassessment-lineage-restart" });
    expect(admitted).toBe(false);
  });
  it("serializes two synthetic admissions and refuses the second changed snapshot", async () => {
    const input = await setup(), snapshot = await transaction(tx => collectReassessmentLineage(tx, input));
    const locked = deferred(), finish = deferred(); let effects = 0;
    const first = transaction(async tx => {
      const token = await lockReassessmentLineage(tx, snapshot, itemIds); locked.resolve(); await finish.promise;
      await revalidateReassessmentLineage(tx, token); await create(tx, "TR-fixture-present-first"); effects++;
    });
    await locked.promise;
    const second = transaction(async tx => {
      const token = await lockReassessmentLineage(tx, snapshot, itemIds); await revalidateReassessmentLineage(tx, token);
      await create(tx, "TR-fixture-present-second"); effects++;
    });
    // Attach rejection observation before releasing the actual lock holder.
    const outcome = second.then(() => null, error => error);
    try { await waitForBlocked("TaskRun"); } finally { finish.resolve(); }
    await first; expect(await outcome).toMatchObject({ code: "reassessment-lineage-restart" });
    expect(effects).toBe(1); expect(await fixture.db.taskRun.count()).toBe(3);
  });
  it("holds the same subject boundary against normal bound review creation", async () => {
    const input = await setup(), snapshot = await transaction(tx => collectReassessmentLineage(tx, input));
    const entered = deferred(), finish = deferred(); let created = false;
    const admission = transaction(async tx => {
      const token = await lockReassessmentLineage(tx, snapshot, itemIds); entered.resolve(); await finish.promise;
      await revalidateReassessmentLineage(tx, token);
    });
    await entered.promise;
    const ordinary = transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "itemId" = ${binding.itemId} FOR UPDATE`;
      await create(tx, "TR-fixture-ordinary"); created = true;
    });
    try { await waitForBlocked("BacklogItem"); expect(created).toBe(false); } finally { finish.resolve(); }
    await Promise.all([admission, ordinary]); expect(created).toBe(true);
  });
  it("rolls back a synthetic post-lock allocation with the complete transaction", async () => {
    const input = await setup(), snapshot = await transaction(tx => collectReassessmentLineage(tx, input));
    await expect(transaction(async tx => {
      const token = await lockReassessmentLineage(tx, snapshot, itemIds); await revalidateReassessmentLineage(tx, token);
      await create(tx, "TR-fixture-must-rollback"); throw new Error("synthetic post-create failure");
    })).rejects.toThrow("synthetic post-create failure");
    expect(await fixture.db.taskRun.count()).toBe(2); expect(await fixture.db.taskMessage.count()).toBe(2);
    expect((await transaction(tx => collectReassessmentLineage(tx, input))).fingerprint).toBe(snapshot.fingerprint);
  });
  it("refuses an ambiguous legacy review linked through the actual owning Workroom FK", async () => {
    const input = await setup();
    const legacy = await fixture.db.taskRun.create({ data: { taskRunId: "TR-fixture-legacy", userId: "fixture-other", title: "Legacy review",
      objective: "Ambiguous review", authorityScope: ["tool:record_initiative_design_review"], a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: null } } });
    await fixture.db.workroom.create({ data: { capsuleId: "WC-LINEAGE-FIXTURE", title: "Synthetic owning room", objective: "Synthetic only",
      status: "ready", source: "external-adoption", backlogItemId: "fixture-subject", taskRunId: legacy.id } });
    await expect(transaction(tx => collectReassessmentLineage(tx, input))).rejects.toMatchObject({ code: "reassessment-lineage-unproven" });
  });
});
