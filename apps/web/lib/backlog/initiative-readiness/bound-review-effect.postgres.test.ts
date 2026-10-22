import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PrismaClient } from "../../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureTaskExecutionFence } from "@/lib/shared/task-execution-fence";
import { Prisma as fixturePrisma } from "@dpf/db";
import { createReviewPostgresFixture } from "../../../test-support/review-postgres-fixture";

const state = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown> }));
vi.mock("@dpf/db", async (original) => {
  const { Prisma } = await import("../../../../../packages/db/generated/client/client");
  return {
    ...await original<typeof import("@dpf/db")>(),
    Prisma,
    prisma: new Proxy({}, { get(_target, key) {
      const value = state.db[key as string];
      return typeof value === "function" ? value.bind(state.db) : value;
    } }),
  };
});
// Only external provenance/storage and reviewer lookup are injected. The two
// production writers, their transaction/locks, receipts, baselines and pins run
// against real PostgreSQL. These fixtures are not independent review receipts.
vi.mock("./artifact-resolver", () => ({ resolveInitiativeArtifact: async () => ({
  ok: true, artifact: { ref: artifactRef, digest: `sha256:${digest}`,
    authorPrincipalId: "fixture-author", authorAgentId: "fixture-author-agent", bytes: Buffer.from(content) },
}) }));
vi.mock("./reviewer-identity", async (original) => ({ ...await original<typeof import("./reviewer-identity")>(),
  resolveReviewerIdentity: async () => ({ principalId: "fixture-reviewer-principal", kind: "coworker" }),
}));
vi.mock("@/lib/documents/blob-storage", () => ({ writeDocumentBlob: async () => ({
  sha256: digest, storageKey: `fixture/${digest}`, sizeBytes: Buffer.byteLength(content),
}) }));

import { recordInitiativeGateReceipt } from "./receipt-repository";
import { recordInitiativeSpecApproval } from "./baseline-repository";

// The shared runner supplies its isolated slot only after governed admission.
// Never fall back to the install's general DATABASE_URL.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
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

function earlyWriterResult(result: { ok: boolean; code?: string; error?: string }) {
  return new Error(`Writer returned before its PostgreSQL lock: ${JSON.stringify({
    ok: result.ok, code: result.code, error: result.error?.slice(0, 1000),
  })}`);
}

it("exposes the real Prisma transaction isolation helper before PostgreSQL admission", () => {
  expect(fixturePrisma.TransactionIsolationLevel.Serializable).toBe("Serializable");
});

describe.skipIf(!url)("canonical review writer transactions on PostgreSQL", () => {
  let pool: Pool, db: PrismaClient;
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>> | undefined;
  beforeAll(async () => {
    fixture = await createReviewPostgresFixture({ url: url!, schema, tables });
    ({ pool, db } = fixture);
    state.db = db as unknown as Record<string, unknown>;
  });
  afterAll(async () => {
    await fixture?.close();
  });

  async function waitForBlockedWriter(table: "TaskRun" | "BacklogItem" = "TaskRun") {
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const rows = await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2", [schema, `%${table}%`]);
      if (rows.rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`The actual writer did not reach its PostgreSQL ${table} lock.`);
  }
  const verdictCount = () => db.backlogItemActivity.count({ where: { kind: "initiative_gate_receipt" } });

  it("uses real isolated enums with canonical labels and no public table fallback", async () => {
    const types = await pool.query<{ namespace: string; type_kind: string; labels_match: boolean }>(`
      SELECT en.nspname AS namespace, e.typtype AS type_kind,
        ARRAY(SELECT v.enumlabel FROM pg_enum v WHERE v.enumtypid = e.oid ORDER BY v.enumsortorder)
        = ARRAY(SELECT v.enumlabel FROM pg_enum v JOIN pg_type p ON p.oid = v.enumtypid
            JOIN pg_namespace pn ON pn.oid = p.typnamespace
            WHERE pn.nspname = 'public' AND p.typname = e.typname ORDER BY v.enumsortorder) AS labels_match
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_type e ON e.oid = CASE WHEN t.typtype = 'e' THEN t.oid ELSE t.typelem END
      JOIN pg_namespace en ON en.oid = e.typnamespace
      WHERE n.nspname = $1 AND c.relname = 'BacklogItemActivity' AND a.attname = 'gateKey'
    `, [schema]);
    expect(types.rows).toEqual([{ namespace: schema, type_kind: "e", labels_match: true }]);
    const isolation = await pool.query("SELECT current_schemas(false)::text[] AS schemas, to_regclass('\"Principal\"') AS missing_table");
    expect(isolation.rows).toEqual([{ schemas: [schema], missing_table: null }]);
    await expect(pool.query(`SELECT 'invalid-fixture-gate'::"${schema}"."InitiativeGateKey"`))
      .rejects.toMatchObject({ code: "22P02" });
    await expect(pool.query(`INSERT INTO "InitiativeArtifactRetentionPin"
      ("id", "baselineActivityId", "sourceKind", "artifactDigest", "artifactLocator")
      VALUES ('invalid-fixture-pin', 'invalid-fixture-baseline', 'document-version', $1, '{}'::jsonb)`, [digest]))
      .rejects.toMatchObject({ code: "23514", constraint: "initiative_artifact_retention_pin_shape" });
  });
  async function displace(client: PoolClient, change: string) {
    const progress = ["unknown", "working-unknown"].includes(change) ? { executionUncertainty: { schemaVersion: 1, settlement: "unknown" } }
      : change === "generation" ? { resumeReservedAt: "new-admission" }
        : change === "dispatch" ? { dispatch: { claimedAt: "new-dispatch" } }
          : change === "authority" ? { reviewExecutionAuthority: { schemaVersion: 1, tokenId: "new-authority" } } : {};
    const status = change === "cancellation" ? "canceled"
      : ["hold", "unknown"].includes(change) ? "input-required" : "working";
    await client.query('UPDATE "TaskRun" SET status=$1,"progressPayload"=$2::jsonb,"updatedAt"=clock_timestamp() WHERE "taskRunId"=$3', [status, JSON.stringify(progress), taskRunId]);
  }

  for (const writer of writers) describe(writer.gate, () => {
    beforeEach(async () => {
      await pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`);
      await db.organization.create({ data: { orgId: "fixture-org", slug: "fixture-org", name: "Fixture" } });
      await db.backlogItem.create({ data: { itemId: common.itemId, title: "Fixture", status: "open", type: "product", workType: "feature", scopeKind: "platform" } });
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

    it.each(["hold", "unknown", "working-unknown", "generation", "dispatch", "authority", "cancellation"])("appends nothing when %s wins the real row lock", async (change) => {
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      let pending: ReturnType<typeof writer.run> | undefined;
      try {
        await displace(blocker, change);
        pending = writer.run();
        void pending.catch(() => undefined);
        await Promise.race([waitForBlockedWriter(), pending.then(result => { throw earlyWriterResult(result); })]);
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
      const subjectBlocker = await pool.connect(), taskUpdater = await pool.connect();
      await subjectBlocker.query("BEGIN");
      let publication: ReturnType<typeof writer.run> | undefined;
      let displacement: Promise<unknown> | undefined;
      try {
        // Both actual writers lock TaskRun before BacklogItem. Hold only the
        // subject so the writer owns its TaskRun lock before queuing the hold.
        await subjectBlocker.query('SELECT "id" FROM "BacklogItem" WHERE "itemId"=$1 FOR UPDATE', [common.itemId]);
        publication = writer.run();
        void publication.catch(() => undefined);
        await Promise.race([waitForBlockedWriter("BacklogItem"), publication.then(result => { throw earlyWriterResult(result); })]);
        displacement = displace(taskUpdater, "unknown");
        void displacement.catch(() => undefined);
        await waitForBlockedWriter();
        await subjectBlocker.query("COMMIT");
        const result = await publication;
        expect(result).toMatchObject({ ok: true });
        await displacement;
        expect(await writer.run()).toMatchObject({ ok: true, deduplicated: true });
        expect(await verdictCount()).toBe(1);
        expect(await db.initiativeArtifactRetentionPin.count()).toBe(writer.gate === "spec-approval" ? 1 : 0);
      } finally {
        await subjectBlocker.query("ROLLBACK");
        await publication?.catch(() => undefined); await displacement?.catch(() => undefined);
        subjectBlocker.release(); taskUpdater.release();
      }
    }, 15000);
  });
});
