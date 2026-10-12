import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn(), allowed: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { $transaction: (fn: (db: unknown) => unknown) => fn({ workroom: { findUnique: m.find, updateMany: m.update }, workroomActivity: { create: m.audit } }) } }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: m.user }));
vi.mock("@/lib/permissions", () => ({ can: m.allowed }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/evidence/bounded-evidence-output", () => ({ offloadEvidenceOutput: async (x: unknown) => x }));
import { reviewWorkroomSensitivityTool, correctWorkroomSensitivityTool } from "./workroom-sensitivity-review.server";
const room = () => ({ id: "row", capsuleId: "WC-TEST", updatedAt: new Date("2026-10-11T00:00:00Z"), scopeClaims: [{ workroomBoundary: { sensitivityCeiling: "engineering-only", outcome: "private original" } }, { workroomShape: "untouched" }] });
beforeEach(() => { vi.clearAllMocks(); m.user.mockResolvedValue({ userId: "admin" }); m.allowed.mockReturnValue(true); m.find.mockResolvedValue(room()); m.update.mockResolvedValue({ count: 1 }); m.audit.mockResolvedValue({ id: "audit" }); });
async function args() { const r = await reviewWorkroomSensitivityTool({ capsuleId: "WC-TEST" }, "admin"); return { capsuleId: "WC-TEST", expectedDigest: r.data?.digest, sensitivity: "internal", classificationReviewed: true, rationale: "Administrator verified the original information classification." }; }
describe("exact-room classification recovery", () => {
  it("returns only administrative classification state, without unknown prose or room contents", async () => {
    const r = await reviewWorkroomSensitivityTool({ capsuleId: "WC-TEST" }, "admin");
    expect(r.success).toBe(true); expect(r.data).toMatchObject({ needsReview: true, classification: null });
    expect(JSON.stringify(r)).not.toMatch(/engineering-only|private original|untouched/);
  });
  it("denies non-administrators before reading the room", async () => { m.allowed.mockReturnValue(false); const r = await reviewWorkroomSensitivityTool({ capsuleId: "WC-TEST" }, "other"); expect(r.success).toBe(false); expect(m.find).not.toHaveBeenCalled(); });
  it("refuses stale review digests with no writes", async () => { const a = await args(); const r = await correctWorkroomSensitivityTool({ ...a, expectedDigest: "0".repeat(64) }, "admin"); expect(r.success).toBe(false); expect(m.update).not.toHaveBeenCalled(); });
  it("requires an explicit reviewed classification and rationale", async () => { const a = await args(); for (const bad of [{ classificationReviewed: false }, { rationale: "" }, { sensitivity: "engineering-only" }]) { const r = await correctWorkroomSensitivityTool({ ...a, ...bad }, "admin"); expect(r.success).toBe(false); } expect(m.update).not.toHaveBeenCalled(); });
  it("does not lower an already valid classification through recovery", async () => { m.find.mockResolvedValue({ ...room(), scopeClaims: [{ workroomBoundary: { sensitivityCeiling: "restricted" } }] }); const r = await correctWorkroomSensitivityTool(await args(), "admin"); expect(r.success).toBe(false); expect(m.update).not.toHaveBeenCalled(); });
  it("changes only the invalid ceiling and retains the original declaration in an audit", async () => { const r = await correctWorkroomSensitivityTool(await args(), "admin", { agentId: "AGT-TEST", approvedAuthorityEnvelopeId: "AE-TEST" }); expect(r.success).toBe(true); const change = m.update.mock.calls[0][0]; expect(change.where.updatedAt).toEqual(room().updatedAt); expect(change.data.scopeClaims).toEqual([{ workroomBoundary: { sensitivityCeiling: "internal", outcome: "private original" } }, { workroomShape: "untouched" }]); const audit=m.audit.mock.calls[0][0].data; expect(audit.recordedById).toBe("admin"); expect(audit.recordedByAgentId).toBe("AGT-TEST"); expect(audit.payload.originalDeclarationJson).toContain("engineering-only"); });
  it("refuses a coworker's own unapproved classification attestation", async () => { const a=await args(); const r=await correctWorkroomSensitivityTool(a,"admin",{agentId:"AGT-TEST"}); expect(r.error).toBe("classification_review_required"); expect(m.update).not.toHaveBeenCalled(); });
  it("does not trust an approval reference supplied as a tool argument", async () => {
    const result = await correctWorkroomSensitivityTool(
      { ...await args(), approvedAuthorityEnvelopeId: "AE-FORGED" }, "admin", { agentId: "AGT-TEST" },
    );
    expect(result.error).toBe("classification_review_required");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("retains the trusted approval reference with the classification audit", async () => {
    await correctWorkroomSensitivityTool(await args(), "admin", {
      agentId: "AGT-TEST", approvedAuthorityEnvelopeId: "AE-TEST",
    });
    expect(m.audit.mock.calls[0][0].data.payload.approvedAuthorityEnvelopeId).toBe("AE-TEST");
  });
  it("refuses a concurrent update and writes no audit", async () => { m.update.mockResolvedValue({ count: 0 }); const r = await correctWorkroomSensitivityTool(await args(), "admin"); expect(r.success).toBe(false); expect(m.audit).not.toHaveBeenCalled(); });
  it("rechecks administrator authority before correction", async () => { const a=await args(); m.allowed.mockReturnValue(false); const r=await correctWorkroomSensitivityTool(a,"admin"); expect(r.success).toBe(false); expect(m.update).not.toHaveBeenCalled(); });
  it("does not report success when its transactional audit fails", async () => { const a=await args(); m.audit.mockRejectedValueOnce(new Error("audit unavailable")); await expect(correctWorkroomSensitivityTool(a,"admin")).rejects.toThrow("audit unavailable"); });
});
