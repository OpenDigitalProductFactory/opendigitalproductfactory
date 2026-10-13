import { describe, expect, it, vi } from "vitest";

import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { withReviewReceiptEvidence } from "./workroom-drive-review-stages";

vi.mock("@dpf/db", () => ({ prisma: {}, Prisma: {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  join: (values: unknown[]) => values,
} }));

// BI-80738C08: the drive reads a passed readiness review as the review stage's evidence.
describe("withReviewReceiptEvidence", () => {
  const head = "a".repeat(40);
  const ASKED = new Date("2026-10-07T10:00:00Z");
  function db(decision: string, opts: { headSha?: string; asks?: unknown[] } = {}) {
    const payload = {
      schemaVersion: 1, receiptId: "pr-1", policyVersion: "initiative-readiness.v3", gate: "plan-review", decision,
      artifactDigest: "digest", artifactAuthorRef: "author", reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-WS-REVIEW",
      authorityDecisionId: "DI-1", reason: "Plan reviewed.", subject: { kind: "backlog-item", id: "BI-1" },
      findingRefs: decision === "fail" ? ["F-1"] : [], resolvedFindingRefs: [],
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: head, path: "docs/plan.md", providerBlobId: "b".repeat(40) },
      authoritySnapshot: { decision: "allow", effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "initiative_design_review",
        tokenScope: "write", organizationId: "org", actionKey: "review", policyVersion: "authority.v1" },
    };
    const $queryRaw = vi.fn()
      .mockResolvedValueOnce([{ id: "pr-1", backlogItemId: "item-row", gateKey: "plan-review", recordedAt: new Date("2026-10-07T11:00:00Z"), payload }])
      .mockResolvedValueOnce(opts.asks ?? [{ capsuleId: "WC-1", stageKey: "plan", startedAt: ASKED }]);
    return {
      $queryRaw,
      workroom: { findMany: vi.fn(async () => [{ capsuleId: "WC-1", backlogItemId: "BI-1", repositoryFullName: "org/repo",
        headSha: opts.headSha ?? head, scopeClaims: [buildWorkShapeClaim({ key: "delivery-large", version: "1.0.0" })] }]) },
      backlogItem: { findMany: vi.fn(async () => [{ id: "item-row", itemId: "BI-1" }]) },
    };
  }
  const base = { capsuleId: "WC-1", recordedEvidence: [], stageDispatchedAt: null as Date | null };

  it("turns a passing plan review into completing plan-stage evidence, started at the reviewer ask", async () => {
    const [room] = await withReviewReceiptEvidence([base], db("pass") as never);
    expect(room!.stageDispatchedAt).toEqual(ASKED);
    expect(room!.recordedEvidence).toEqual([{ stageKey: "plan", kind: "plan-review-receipt", outcome: "completed", recordedAt: new Date("2026-10-07T11:00:00Z") }]);
  });

  it("turns a failing plan review into a blocker", async () => {
    const [room] = await withReviewReceiptEvidence([base], db("fail") as never);
    expect(room!.recordedEvidence).toEqual([expect.objectContaining({ stageKey: "plan", outcome: "blocked" })]);
  });

  it("leaves the room unchanged for a review of a superseded head", async () => {
    const [room] = await withReviewReceiptEvidence([base], db("pass", { headSha: "c".repeat(40) }) as never);
    expect(room).toBe(base);
  });

  it("fails open to the rooms unchanged when the receipts cannot be read", async () => {
    const broken = db("pass"); broken.workroom.findMany.mockRejectedValueOnce(new Error("down"));
    expect(await withReviewReceiptEvidence([base], broken as never)).toEqual([base]);
  });
});
