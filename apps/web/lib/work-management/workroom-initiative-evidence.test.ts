import { describe, expect, it, vi } from "vitest";
import { loadWorkroomExecutionEvidence } from "./workroom-execution-evidence";
vi.mock("@dpf/db", () => ({ prisma: {}, Prisma: {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  join: (values: unknown[]) => values,
} }));

const head = "a".repeat(40);
const now = new Date("2026-09-23T00:00:00Z");
const room = { id: "room-row", capsuleId: "WC-1", backlogItemId: "BI-1",
  repositoryFullName: "org/repo", headSha: head,
  scopeClaims: [{ workShape: "delivery-break-fix@1.0.0" }] };
function queryText(query: TemplateStringsArray | { strings: readonly string[] }) {
  return ("strings" in query ? query.strings : query).join("");
}
function setup(overrides: Record<string, unknown> = {}, failedRead?: "reviewers" | "initiative") {
  const payload = { schemaVersion: 1, receiptId: "pir-1", policyVersion: "initiative-readiness.v3",
    gate: "post-implementation-review", decision: "pass", artifactDigest: "digest",
    artifactAuthorRef: "author", reviewerPrincipalId: "reviewer", reviewerAgentId: "agent",
    authorityDecisionId: "DI-1", reason: "Independent symptom verification passed.",
    subject: { kind: "backlog-item", id: "BI-1" }, findingRefs: [], resolvedFindingRefs: [],
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: head,
      path: "apps/web/fix.ts", providerBlobId: "b".repeat(40) },
    authoritySnapshot: { decision: "allow", effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "initiative_post_implementation_review", tokenScope: "write",
      organizationId: "org", actionKey: "review", policyVersion: "authority.v1" }, ...overrides };
  const queryRaw = vi.fn();
  queryRaw.mockImplementation(async (query: TemplateStringsArray | { strings: readonly string[] }) => {
    const sql = queryText(query);
    if (sql.includes("candidates AS MATERIALIZED")) {
      if (failedRead === "reviewers") throw new Error("Reviewer source unavailable");
      return [];
    }
    if (sql.includes('FROM "BacklogItemActivity"')) {
      if (failedRead === "initiative") throw new Error("Initiative source unavailable");
      return [{ id: "pir-1", backlogItemId: "item-row",
        gateKey: "post-implementation-review", recordedAt: now, payload }];
    }
    if (sql.includes('FROM "WorkCapsuleActivity"')) return [];
    throw new Error("Unexpected evidence query");
  });
  return { workroomActivity: { findMany: vi.fn().mockResolvedValue([]) },
    backlogItem: { findMany: vi.fn().mockResolvedValue([{ id: "item-row", itemId: "BI-1" }]) },
    $queryRaw: queryRaw };
}

describe("governed initiative evidence in a Workroom", () => {
  it("exposes the real PIR and matches its required step without claiming completion", async () => {
    const db = setup();
    const result = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(result.partial).toBe(false);
    expect(result.reviewerRuns).toEqual([]);
    const queries = db.$queryRaw.mock.calls.map(([query]) => queryText(query));
    expect(queries.filter(sql => sql.includes("candidates AS MATERIALIZED"))).toHaveLength(1);
    expect(queries.filter(sql => sql.includes('FROM "BacklogItemActivity"'))).toHaveLength(1);
    expect(queries.filter(sql => sql.includes('FROM "WorkCapsuleActivity"'))).toHaveLength(1);
    expect(result.receipts).toContainEqual(expect.objectContaining({ receiptId: "pir-1", status: "observed",
      rawRef: { table: "BacklogItemActivity", id: "pir-1" },
      processEvidence: { definitionRef: "delivery-break-fix@1.0.0", stageKey: "post-implementation-review",
        evidenceKind: "pir-receipt", relationship: "required-evidence" },
    }));
  });
  it("keeps old source evidence visible without correlating it to the current step", async () => {
    const result = await loadWorkroomExecutionEvidence(setup(), [{ ...room, headSha: "c".repeat(40) }], now);
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0].processEvidence).toBeUndefined();
    expect(result.receipts[0].summary).toContain("historical");
  });
  it("does not attribute another subject's receipt to this room", async () => {
    const result = await loadWorkroomExecutionEvidence(setup({ subject: { kind: "backlog-item", id: "BI-OTHER" } }), [room], now);
    expect(result.receipts).toEqual([]);
    expect(result.partial).toBe(true);
  });
  it.each([
    { repositoryFullName: "other/repo" },
    { scopeClaims: [{ workShape: "delivery-break-fix@99.0.0" }] },
  ])("does not bind evidence across repository or definition boundaries: %j", async (boundary) => {
    const result = await loadWorkroomExecutionEvidence(setup(), [{ ...room, ...boundary }], now);
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0].processEvidence).toBeUndefined();
    expect(result.receipts[0].status).toBe("observed");
  });
  it("shows a failing review's findings in the room", async () => {
    const result = await loadWorkroomExecutionEvidence(setup({ decision: "fail", findingRefs: ["F-1", "F-2"] }), [room], now);
    expect(result.receipts[0].summary).toContain("post-implementation-review: fail, 2 findings");
  });
  it("reports unavailable initiative evidence instead of a complete empty result", async () => {
    const db = setup({}, "initiative");
    const result = await loadWorkroomExecutionEvidence(db, [room], now);
    expect(result.receipts).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.attentionReason).toBeNull();
  });
  it("retains initiative evidence when the candidate read fails", async () => {
    const result = await loadWorkroomExecutionEvidence(setup({}, "reviewers"), [room], now);
    expect(result.partial).toBe(true);
    expect(result.attentionReason).toContain("could not be read");
    expect(result.receipts).toContainEqual(expect.objectContaining({ receiptId: "pir-1" }));
  });
});
