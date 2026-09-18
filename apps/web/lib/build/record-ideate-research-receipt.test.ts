import { beforeEach, describe, expect, it, vi } from "vitest";

// The ideate research attestation must run as a GOVERNED tool call by the
// Build Lead coworker, bound to the accepted designDoc revision, and must
// return the governance outcome in words — never a silent no-op.
const { mockPrisma, mockGoverned } = vi.hoisted(() => ({
  mockPrisma: {
    featureBuild: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    buildArtifactRevision: { findFirst: vi.fn() },
  },
  mockGoverned: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: mockGoverned }));

const designDoc = { existingFunctionalityAudit: "audited item-body-baseline.ts", reusePlan: "extend it" };

describe("recordIdeateResearchReceipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.featureBuild.findUnique.mockResolvedValue({ originator: { itemId: "BI-660E165F" } });
    mockPrisma.user.findUnique.mockResolvedValue({ isSuperuser: true });
    mockPrisma.buildArtifactRevision.findFirst.mockResolvedValue({ id: "rev-42" });
  });

  it("records through the governed executor as AGT-WS-BUILD, bound to the accepted design revision", async () => {
    mockGoverned.mockResolvedValue({ success: true });
    const { recordIdeateResearchReceipt, IDEATE_ATTESTATION_AGENT_ID } = await import("./record-ideate-research-receipt");
    const out = await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc, revisionId: "review:FB-1", authorUserId: "u-1", authorAgentId: null });
    expect(out).toEqual({ recorded: true, reason: "research receipt recorded" });
    const call = mockGoverned.mock.calls[0][0];
    expect(call.toolName).toBe("record_initiative_evidence");
    expect(call.rawParams).toMatchObject({ itemId: "BI-660E165F", gate: "research", decision: "pass", artifactRef: { kind: "feature-build-revision", revisionId: "rev-42" } });
    expect(call.rawParams.reason).toContain("existingFunctionalityAudit");
    expect(call.context).toMatchObject({ agentId: IDEATE_ATTESTATION_AGENT_ID, featureBuildId: "FB-1", tokenScope: "write" });
    expect(call.userContext).toEqual({ userId: "u-1", platformRole: null, isSuperuser: true });
  });

  it("reports the governance rejection in words instead of swallowing it", async () => {
    mockGoverned.mockResolvedValue({ success: false, error: "approval_required", message: "needs employee approval", governance: { rejected: "approval_required" } });
    const { recordIdeateResearchReceipt } = await import("./record-ideate-research-receipt");
    const out = await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc, revisionId: "x", authorUserId: "u-1", authorAgentId: "AGT-9" });
    expect(out.recorded).toBe(false);
    expect(out.reason).toContain("approval_required");
    expect(out.reason).toContain("needs employee approval");
    expect(mockGoverned.mock.calls[0][0].context.agentId).toBe("AGT-9");
  });

  it("refuses truthfully when the design records no research or no accepted revision exists", async () => {
    const { recordIdeateResearchReceipt } = await import("./record-ideate-research-receipt");
    const noResearch = await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc: { problemStatement: "x" }, revisionId: "x", authorUserId: "u-1", authorAgentId: null });
    expect(noResearch.recorded).toBe(false);
    mockPrisma.buildArtifactRevision.findFirst.mockResolvedValue(null);
    const noRevision = await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc, revisionId: "x", authorUserId: "u-1", authorAgentId: null });
    expect(noRevision.reason).toMatch(/accepted designDoc revision/);
    expect(mockGoverned).not.toHaveBeenCalled();
  });
});
