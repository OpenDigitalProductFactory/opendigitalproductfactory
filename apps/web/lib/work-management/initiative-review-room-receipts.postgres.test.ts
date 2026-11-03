import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInitiativeReviewRoomReceipts, type InitiativeReceiptClient } from "./initiative-review-room-receipts";
import type { ReviewerRoomCandidate } from "./review-room-candidates";

// Only the admitted read-only harness. CTEs shadow all domain tables; no writes.
const admittedUrl = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
if (process.env.DPF_LOCAL_CI_SLOT_KEY && !admittedUrl) throw new Error("Admitted local CI requires its SQL test database URL.");
const url = admittedUrl ?? (process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;
const now = new Date("2026-11-03T10:00:00Z");

function fixture() {
  const binding = { writerToolName: "record_initiative_design_review", itemId: "BI-1", gate: "spec-approval",
    workroomRef: { kind: "workroom-head", workroomId: "WC-1", repositoryFullName: "owner/repo",
      branchName: "fix/receipt", headSha: "a".repeat(40) }, artifactRef: { kind: "repo-blob-at-commit",
      repositoryFullName: "owner/repo", commitSha: "b".repeat(40), path: "docs/design.md", providerBlobId: "c".repeat(40) } };
  const candidate = { id: "row", taskRunId: "TR-1", userId: "user", status: "completed", createdAt: new Date("2026-11-03T09:00:00Z"),
    updatedAt: now, lastHeartbeatAt: now, capsuleId: "WC-1", reviewKind: "initiative-review", ambiguousReviewKind: false,
    progressPayload: {}, progressTruncated: false, nodes: [], nodesTruncated: false, initiativeBinding: binding,
    bindingTruncated: false, requestDigest: "d".repeat(64), requesterAgentId: "AGT-AUTHOR", metadataTrigger: "external-mcp",
    roomRepositoryFullName: "owner/repo", roomHeadBranch: "fix/receipt", roomHeadSha: "a".repeat(40), roomBacklogItemId: "BI-1", user: null } as ReviewerRoomCandidate;
  const payload = { schemaVersion: 1, receiptId: "receipt", gate: "spec-approval", decision: "fail", policyVersion: "initiative-v1",
    artifactDigest: "sha256:" + "e".repeat(64), subject: { kind: "backlog-item", id: "BI-1" }, artifactRef: { ...binding.artifactRef },
    artifactAuthorRef: "principal:author|agent:author", reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-REVIEWER",
    authorityDecisionId: "AUTH-1", authoritySnapshot: { decision: "allow", actionKey: binding.writerToolName,
      policyVersion: "authority-v1", organizationId: "platform", effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "initiative_design_review", tokenScope: "write" }, findingRefs: ["finding"], resolvedFindingRefs: [], reason: "Required proof is missing." };
  return { candidate, data: { task: { id: "row", taskRunId: "TR-1", userId: "user", archivedAt: null as string | null,
    a2aMetadata: { trigger: "external-mcp", requestDigest: "d".repeat(64), initiativeReviewBinding: structuredClone(binding) } },
    item: { id: "item", itemId: "BI-1", organizationId: null },
    authority: { decisionId: "AUTH-1", decision: "allow", actionKey: binding.writerToolName,
      organizationId: null, policyVersion: "authority-v1", rationale: { taskRunId: "TR-1" } }, envelopes: [],
    activities: [{ id: "receipt", backlogItemId: "item", kind: "initiative_gate_receipt", gateKey: "spec_approval", recordedAt: now.toISOString(), payload }] } };
}

databaseSuite("ordinary receipt correlation SQL", () => {
  let client: Client;
  beforeAll(async () => { client = new Client({ connectionString: url,
    options: "-c default_transaction_read_only=on -c statement_timeout=5000" }); await client.connect(); });
  afterAll(async () => { await client?.end(); });

  async function project(value = fixture()) {
    const db = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      const parameter = `$${values.length + 1}`;
      const query = `WITH fixture AS (SELECT ${parameter}::jsonb AS data),
        "TaskRun" AS (SELECT t.* FROM fixture, jsonb_to_record(data->'task') AS t(id text, "taskRunId" text,
          "userId" text, "archivedAt" timestamptz, "a2aMetadata" jsonb)),
        "BacklogItem" AS (SELECT b.* FROM fixture, jsonb_to_record(data->'item') AS b(id text, "itemId" text, "organizationId" text)),
        "BacklogItemActivity" AS (SELECT a.* FROM fixture, jsonb_to_recordset(data->'activities') AS a(id text,
          "backlogItemId" text, kind text, "gateKey" text, "recordedAt" timestamptz, payload jsonb)),
        "AuthorizationDecisionLog" AS (SELECT d.* FROM fixture, jsonb_to_record(data->'authority') AS d(
          "decisionId" text, decision text, "actionKey" text, "organizationId" text, "policyVersion" text, rationale jsonb)),
        "CoworkerActionEnvelope" AS (SELECT e.* FROM fixture, jsonb_to_recordset(data->'envelopes') AS e(
          "authorityDecisionId" text, "taskRunId" text)) ${sql}`;
      return (await client.query({ text: query, values: [...values, JSON.stringify(value.data)] })).rows;
    }, authorizationDecisionLog: { findUnique: async () => ({ decision: "allow", actionKey: "record_initiative_design_review",
      organizationId: null, policyVersion: "authority-v1", rationale: { taskRunId: "TR-1" } }) },
    coworkerActionEnvelope: { findMany: async () => [] } };
    return loadInitiativeReviewRoomReceipts(db as unknown as InitiativeReceiptClient, [value.candidate], now);
  }

  it("correlates the exact native domain receipt without reading a live table", async () => {
    const result = await project(); expect(result.partialRooms.size).toBe(0);
    expect(result.receipts.get("row")).toMatchObject({ id: "receipt", decision: "fail", summary: "Required proof is missing." });
  });

  it.each(["user", "digest", "binding", "archived", "item", "gate", "artifact"])("refuses changed %s before a verdict", async kind => {
    const value = fixture();
    if (kind === "user") value.data.task.userId = "another-user";
    if (kind === "digest") value.data.task.a2aMetadata.requestDigest = "f".repeat(64);
    if (kind === "binding") value.data.task.a2aMetadata.initiativeReviewBinding.workroomRef.headSha = "f".repeat(40);
    if (kind === "archived") value.data.task.archivedAt = now.toISOString();
    if (kind === "item") value.data.activities[0].backlogItemId = "foreign-item";
    if (kind === "gate") value.data.activities[0].gateKey = "architecture_review";
    if (kind === "artifact") value.data.activities[0].payload.artifactRef.providerBlobId = "f".repeat(40);
    expect((await project(value)).receipts.size).toBe(0);
  });

  it.each(["oversized", "overflow", "ambiguous"])("marks actual SQL %s evidence incomplete", async kind => {
    const value = fixture();
    if (kind === "oversized") value.data.activities[0].payload.reason = "x".repeat(32769);
    if (kind === "overflow" || kind === "ambiguous") value.data.activities = Array.from({ length: kind === "overflow" ? 21 : 2 }, (_, index) => ({
      ...value.data.activities[0], id: `receipt-${index}`, payload: { ...value.data.activities[0].payload, receiptId: `receipt-${index}` } }));
    const result = await project(value);
    expect(result.receipts.size).toBe(0); expect(result.partialRooms.has("WC-1")).toBe(true);
  });
});
