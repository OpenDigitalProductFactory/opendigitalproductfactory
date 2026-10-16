import { createHash } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSemanticReviewRequest } from "@/lib/change-review/semantic-review-request";
import { createSemanticReviewReceipt } from "@/lib/change-review/semantic-change-review";
import { loadSemanticReviewRoomProjection, type ReviewerRoomClient, type ReviewerRunSnapshot } from "./semantic-review-room-projection";

// Same governed, read-only PostgreSQL harness as workroom-stall.postgres.test.ts.
// Fixture CTEs shadow every physical table; no records or schema are modified.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;
const now = new Date("2026-10-16T04:00:00Z");
const head = "a".repeat(40);
const artifact = "diff --git a/a.ts b/a.ts\n+reviewed change\n";

function fixture(version: 1 | 2 = 2) {
  const packet = createSemanticReviewRequest({
    surface: "external", authorSurface: "codex-desktop", artifactType: "code-change",
    title: "Current review", artifact, verificationEvidence: "Affected checks passed",
    changedFiles: ["apps/web/lib/a.ts"],
    identity: { capsuleId: "WC-SQL", baseTreeHash: "b".repeat(40), headTreeHash: head,
      sourceHeadSha: head, diffDigest: createHash("sha256").update(artifact).digest("hex"), specialistIds: [] },
  }, { userId: "requester", agentId: "AGT-EXT-CODEX", apiTokenId: null, authSource: "pat" },
  new Date("2026-10-16T03:50:00Z"), version);
  return {
    packet: packet as unknown as Record<string, any>,
    task: { id: "row", taskRunId: "TR-SQL", userId: "requester",
      a2aMetadata: { capsuleId: "WC-SQL", gateKey: packet.gateKey },
      progressPayload: { evidenceRecordId: "receipt", semanticReview: { requestDigest: packet.digest } } },
    room: { id: "room", capsuleId: "WC-SQL", headSha: head, repositoryFullName: packet.repository },
    receipt: { id: "receipt", taskRunId: "TR-SQL", workCapsuleId: "room", actorUserId: "requester",
      operationType: "semantic-change-review.receipt", createdAt: now.toISOString(),
      details: createSemanticReviewReceipt({ identity: packet.input.identity, disposition: "reviewed", risk: "high",
        result: { decision: "pass", summary: "Completed current review", issues: [] } }) },
  };
}

databaseSuite("semantic review readback SQL on PostgreSQL", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url,
      options: "-c default_transaction_read_only=on -c statement_timeout=5000" });
    await client.connect();
  });
  afterAll(async () => { await client?.end(); });

  async function project(data = fixture()) {
    let sqlFailure: unknown;
    const row: ReviewerRunSnapshot = { ...data.task, status: "completed", updatedAt: now,
      lastHeartbeatAt: now, nodes: [] };
    const db = {
      taskRun: { findMany: async () => [row] },
      $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const sql = parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
        const parameter = `$${values.length + 1}`;
        const text = `WITH fixture AS (SELECT ${parameter}::jsonb AS data),
          "TaskRun" AS (SELECT t.* FROM fixture,
            jsonb_to_record(data->'task') AS t(id text, "taskRunId" text, "userId" text,
              "a2aMetadata" jsonb, "progressPayload" jsonb)),
          "WorkCapsule" AS (SELECT w.* FROM fixture,
            jsonb_to_record(data->'room') AS w(id text, "capsuleId" text, "headSha" text, "repositoryFullName" text)),
          "TaskArtifact" AS (SELECT 'row'::text AS "taskRunId", 'semantic-review-request:TR-SQL'::text AS "artifactId",
            jsonb_build_array(jsonb_build_object('data', data->'packet')) AS parts FROM fixture),
          "ExternalEvidenceRecord" AS (SELECT e.* FROM fixture,
            jsonb_to_record(data->'receipt') AS e(id text, "taskRunId" text, "workCapsuleId" text,
              "actorUserId" text, "operationType" text, "createdAt" timestamptz, details jsonb))
          ${sql}`;
        try {
          return (await client.query({ text, values: [...values, JSON.stringify(data)] })).rows;
        } catch (error) {
          sqlFailure = error;
          throw error;
        }
      },
    } as unknown as ReviewerRoomClient;
    const result = await loadSemanticReviewRoomProjection(db, ["WC-SQL"], now);
    // SQL failure must not satisfy the negative controls via the fail-closed reader.
    expect(sqlFailure).toBeUndefined();
    return result;
  }

  it.each([1, 2] as const)("reads a real canonical schema %i request and its bound receipt", async version => {
    const result = await project(fixture(version));
    expect(result.partial).toBe(false);
    expect(result.runs[0]).toMatchObject({ identityScope: "current", sourceHeadSha: head,
      requesterAgentId: "AGT-EXT-CODEX", receipt: { id: "receipt", decision: "pass" } });
  });

  it.each(["unknown-version", "string-version", "missing-role", "conflicting-role", "legacy-with-role"])(
    "keeps %s requests unknown and withholds their receipts", async invalid => {
      const data = fixture();
      if (invalid === "unknown-version") data.packet.schemaVersion = 3;
      if (invalid === "string-version") data.packet.schemaVersion = "2";
      if (invalid === "missing-role") delete data.packet.input.identity.artifactType;
      if (invalid === "conflicting-role") data.packet.input.identity.artifactType = "spec";
      if (invalid === "legacy-with-role") data.packet.schemaVersion = 1;
      const result = await project(data);
      expect(result.partial).toBe(true);
      expect(result.runs[0]).toMatchObject({ identityScope: "unknown", requesterAgentId: null });
      expect(result.runs[0].receipt).toBeUndefined();
    });

  it.each(["actor", "repository", "capsule", "gate", "digest"])("rejects a mismatched %s binding", async field => {
    const data = fixture();
    if (field === "actor") data.packet.actor.userId = "another-user";
    if (field === "repository") data.packet.repository = "another/repository";
    if (field === "capsule") data.packet.input.identity.capsuleId = "WC-OTHER";
    if (field === "gate") data.packet.gateKey = "other-gate";
    if (field === "digest") data.packet.digest = "other-digest";
    const result = await project(data);
    expect(result.runs[0].identityScope).toBe("unknown");
    expect(result.runs[0].receipt).toBeUndefined();
  });

  it("keeps a prior head historical instead of making its stopped review current", async () => {
    const data = fixture();
    data.room.headSha = "c".repeat(40);
    const result = await project(data);
    expect(result.runs[0].identityScope).toBe("historical");
    expect(result.partial).toBe(false);
    expect(result.attentionReason).toContain("No request for the current source version");
  });

  it("does not expose a receipt belonging to a different requester", async () => {
    const data = fixture();
    data.receipt.actorUserId = "another-user";
    const result = await project(data);
    expect(result.runs[0].identityScope).toBe("current");
    expect(result.runs[0].receipt).toBeUndefined();
  });

  it("withholds a receipt for a different artifact role", async () => {
    const data = fixture();
    data.receipt.details.artifactType = "spec";
    const result = await project(data);
    expect(result.runs[0].identityScope).toBe("current");
    expect(result.runs[0].receipt).toBeUndefined();
  });
});
