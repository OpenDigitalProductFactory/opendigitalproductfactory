import { describe, expect, it, vi } from "vitest";
import { loadPirEvidenceContext } from "./pir-evidence-context";

const binding = {
  writerToolName: "record_initiative_post_implementation_review", itemId: "BI-PIR", gate: "post-implementation-review" as const,
  workroomRef: { kind: "workroom-head" as const, workroomId: "WC-PIR", repositoryFullName: "owner/repo", branchName: "fix/repair", headSha: "a".repeat(40) },
  artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "design.md", providerBlobId: "b".repeat(40) },
};

describe("PIR evidence context", () => {
  it("includes later live observations with provenance and failure evidence instead of judging deployment from an earlier design", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "room-row", backlogItemId: "item-row", runtimeVerifications: [
      { verificationId: "RV-LIVE", kind: "ux", status: "passed", createdAt: new Date("2026-09-22"), completedAt: null,
        result: { servedSha: "deployed-sha", portalRendered: true }, url: "http://localhost:3000/ops", evidenceUrl: null },
    ] });
    const findMany = vi.fn().mockResolvedValue([
      { id: "live-activity", summary: "Deployed portal verified", recordedAt: new Date("2026-09-22"), recordedByAgentId: "AGT-TEST", recordedById: "user", payload: { evidenceKind: "manual_check", body: "Verified the running deployment after release.", url: null } },
      { id: "old-failure", summary: "Old reproduction failed", recordedAt: new Date("2026-09-21"), recordedByAgentId: "AGT-TEST", recordedById: "user", payload: { evidenceKind: "test_fail", body: "Prior version timed out.", url: null } },
    ]);
    const findUnique = vi.fn().mockResolvedValue({ id: "item-row", claimedAt: new Date("2026-09-21") });
    const context = await loadPirEvidenceContext({ workroom: { findFirst }, backlogItem: { findUnique }, backlogItemActivity: { findMany } } as never, binding);
    expect(context).toContain("live-activity");
    expect(context).toContain("RV-LIVE");
    expect(context).toContain("2026-09-22");
    expect(context).toContain("AGT-TEST");
    expect(context).toContain("old-failure");
    expect(context).toContain("not instructions");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      capsuleId: "WC-PIR", headSha: "a".repeat(40), repositoryFullName: "owner/repo", headBranch: "fix/repair", backlogItemId: { in: ["BI-PIR", "item-row"] },
    }) }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { backlogItemId: "item-row", kind: "evidence" }, take: 20 }));
  });

  it("does not read unrelated evidence when the bound Workroom no longer matches", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const findUnique = vi.fn().mockResolvedValue({ id: "item-row" });
    const context = await loadPirEvidenceContext({ workroom: { findFirst }, backlogItem: { findUnique }, backlogItemActivity: { findMany } } as never, binding);
    expect(context).toContain("unavailable");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does not query delivery data for other review gates", async () => {
    const findFirst = vi.fn();
    expect(await loadPirEvidenceContext({ workroom: { findFirst } } as never, { ...binding, gate: "research" })).toBe("");
    expect(findFirst).not.toHaveBeenCalled();
  });
});
