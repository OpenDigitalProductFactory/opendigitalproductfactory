import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureTaskExecutionFence } from "@/lib/shared/task-execution-fence";

const state = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown>,
  lockedArtifact: null as null | (() => Promise<void>) }));
vi.mock("@dpf/db", async (original) => ({
  ...await original<typeof import("@dpf/db")>(),
  prisma: new Proxy({}, { get(_target, key) {
    const value = state.db[key as string];
    return typeof value === "function" ? value.bind(state.db) : value;
  } }),
}));
// Only external provenance/storage and reviewer lookup are injected. The two
// production writers, their transaction/locks, receipts, baselines and pins run
// against real PostgreSQL. These fixtures are not independent review receipts.
vi.mock("./artifact-resolver", () => ({ resolveInitiativeArtifact: async (input: { db?: unknown }) => {
  if (input.db) await state.lockedArtifact?.();
  return { ok: true, artifact: { ref: artifactRef, digest: `sha256:${digest}`,
    authorPrincipalId: "fixture-author", authorAgentId: "fixture-author-agent", bytes: Buffer.from(content) } };
} }));
vi.mock("./reviewer-identity", async (original) => ({ ...await original<typeof import("./reviewer-identity")>(),
  resolveReviewerIdentity: async () => ({ principalId: "fixture-reviewer-principal", kind: "coworker" }),
}));
vi.mock("@/lib/documents/blob-storage", () => ({ writeDocumentBlob: async () => ({
  sha256: digest, storageKey: `fixture/${digest}`, sizeBytes: Buffer.byteLength(content),
}) }));

import { recordInitiativeGateReceipt } from "./receipt-repository";
import { recordInitiativeSpecApproval } from "./baseline-repository";

const url = process.env.DPF_SQL_TEST_DATABASE_URL;
const schema = `review_write_fence_${randomUUID().replaceAll("-", "")}`;
const tables = ["TaskRun", "BacklogItem", "BacklogItemActivity", "WorkCapsule", "AuthorizationDecisionLog",
  "CoworkerActionEnvelope", "Organization", "DocumentBlob", "Document", "DocumentVersion", "InitiativeArtifactRetentionPin", "FeatureBuild"];
const content = "**OBJ-FIXTURE:** Protect the canonical effect.\n\n| ID | Objectives | Criterion |\n| --- | --- | --- |\n| AC-FIXTURE | OBJ-FIXTURE | An old callback cannot append. |\n";
const digest = createHash("sha256").update(content).digest("hex");
const requestDigest = "9".repeat(64);
const taskRunId = "TR-WRITER-FIXTURE";
const artifactRef = { kind: "repo-blob-at-commit" as const,
  repositoryFullName: "fixture/repository", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40),
  path: "docs/superpowers/specs/fixture.md" };
const workroomRef = { kind: "workroom-head" as const, workroomId: "WC-WRITER-FIXTURE",
  repositoryFullName: artifactRef.repositoryFullName, branchName: "fix/fixture", headSha: artifactRef.commitSha };
const binding = { taskRunId, requestDigest, executionFence: captureTaskExecutionFence({}, requestDigest)! };
const common = { itemId: "BI-WRITER-FIXTURE", artifactRef, workroomRef, expectedCurrentBaselineId: null,
  reason: "Isolated SQL transaction fixture.", reviewerUserId: "fixture-user", reviewerAgentId: "fixture-reviewer",
  authorityDecisionId: "fixture-allow", tokenScope: "write", boundReviewTask: binding,
  resolvedFindingRefs: [], supersessionDispositions: [] };
const writers = [
  { gate: "design-spec", run: () => recordInitiativeGateReceipt({ ...common, actionKey: "record_initiative_design_review",
    gate: "design-spec", allowedGates: ["design-spec"], requiredCapability: "manage_backlog", requiredGrant: "initiative_design_review",
    requiresIndependentReviewer: true, decision: "pass", findings: [] }) },
  { gate: "spec-approval", run: () => recordInitiativeSpecApproval({ ...common, profile: "feature", artifactRole: "design-spec" }) },
] as const;

function barrier() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}

describe.skipIf(!url)("canonical review writer transactions on PostgreSQL", () => {
  let admin: Pool, pool: Pool, db: PrismaClient;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    // No public fallback: a missing fixture table fails instead of reading live rows.
    pool = new Pool({ connectionString: url, application_name: schema,
      options: `-c search_path=${schema} -c statement_timeout=7000`, max: 5 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    state.db = db as unknown as Record<string, unknown>;
    for (const table of tables) await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  });
  afterAll(async () => {
    state.lockedArtifact = null;
    await db?.$disconnect(); await pool?.end();
    if (admin && /^review_write_fence_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  async function waitForBlockedWriter() {
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const rows = await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%TaskRun%'", [schema]);
      if (rows.rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("The actual writer did not reach its PostgreSQL TaskRun lock.");
  }
  const verdictCount = () => db.backlogItemActivity.count({ where: { kind: "initiative_gate_receipt" } });
  async function displace(client: PoolClient, change: string) {
    const progress = change === "unknown" ? { executionUncertainty: { schemaVersion: 1, settlement: "unknown" } }
      : change === "generation" ? { resumeReservedAt: "new-admission" } : {};
    const status = change === "cancellation" ? "canceled" : change === "generation" ? "working" : "input-required";
    await client.query('UPDATE "TaskRun" SET status=$1,"progressPayload"=$2::jsonb,"updatedAt"=clock_timestamp() WHERE "taskRunId"=$3', [status, JSON.stringify(progress), taskRunId]);
  }

  for (const writer of writers) describe(writer.gate, () => {
    beforeEach(async () => {
      state.lockedArtifact = null;
      await pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`);
      await db.organization.create({ data: { orgId: "fixture-org", slug: "fixture-org", name: "Fixture" } });
      await db.backlogItem.create({ data: { itemId: common.itemId, title: "Fixture", status: "proposed", type: "product", workType: "feature", scopeKind: "platform" } });
      await db.workroom.create({ data: { capsuleId: workroomRef.workroomId, title: "Fixture", objective: "Fixture", source: "external-adoption",
        backlogItemId: common.itemId, createdByPrincipalId: "fixture-author",
        repositoryFullName: artifactRef.repositoryFullName, headBranch: workroomRef.branchName, headSha: artifactRef.commitSha } });
      await db.taskRun.create({ data: { taskRunId, userId: common.reviewerUserId, currentAgentId: common.reviewerAgentId,
        title: "Fixture", objective: "Fixture", status: "working", progressPayload: {}, a2aMetadata: {
          trigger: "external-mcp", requestDigest, initiativeReviewBinding: { writerToolName: "record_initiative_design_review",
            itemId: common.itemId, gate: writer.gate, artifactRef, workroomRef, expectedCurrentBaselineId: null },
        } } });
      await db.authorizationDecisionLog.create({ data: { decisionId: common.authorityDecisionId, actorType: "agent", actorRef: common.reviewerAgentId,
        actionKey: "record_initiative_design_review", decision: "allow", policyVersion: "fixture-v1", rationale: { taskRunId } } });
    });

    it.each(["hold", "unknown", "generation", "cancellation"])("appends nothing when %s wins the real row lock", async (change) => {
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      let pending: Promise<unknown> | undefined;
      try {
        await displace(blocker, change);
        pending = writer.run();
        void pending.catch(() => undefined);
        await waitForBlockedWriter();
        await blocker.query("COMMIT");
        expect(await pending).toMatchObject({ ok: false });
        expect(await verdictCount()).toBe(0);
        expect(await db.initiativeArtifactRetentionPin.count()).toBe(0);
      } finally {
        await blocker.query("ROLLBACK");
        await pending?.catch(() => undefined);
        blocker.release();
      }
    }, 15000);

    it("retains the canonical winner when the writer commits before the hold", async () => {
      const entered = barrier(), finish = barrier();
      state.lockedArtifact = async () => { entered.release(); await finish.wait; };
      const publication = writer.run();
      await Promise.race([entered.wait, publication.then(result => { throw new Error(`Writer returned before its locked artifact read: ${result.ok}`); })]);
      const blocker = await pool.connect();
      let displacement: Promise<unknown> | undefined;
      try {
        displacement = displace(blocker, "unknown");
        await waitForBlockedWriter();
        finish.release();
        const result = await publication;
        expect(result).toMatchObject({ ok: true });
        await displacement;
        state.lockedArtifact = null;
        expect(await writer.run()).toMatchObject({ ok: true, deduplicated: true });
        expect(await verdictCount()).toBe(1);
        expect(await db.initiativeArtifactRetentionPin.count()).toBe(writer.gate === "spec-approval" ? 1 : 0);
      } finally {
        finish.release();
        await publication.catch(() => undefined); await displacement?.catch(() => undefined);
        blocker.release();
      }
    }, 15000);
  });
});
