import { beforeEach, describe, expect, it, vi } from "vitest";

// The ideate research attestation must run as a GOVERNED tool call by the
// Build Lead coworker, bound to the accepted designDoc revision, and must
// return the governance outcome in words — never a silent no-op.
const { mockPrisma, mockGoverned, mockGrants } = vi.hoisted(() => ({
  mockPrisma: {
    featureBuild: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    buildArtifactRevision: { findFirst: vi.fn() },
    workroom: { findFirst: vi.fn() },
    buildActivity: { findFirst: vi.fn(), create: vi.fn() },
  },
  mockGoverned: vi.fn(),
  mockGrants: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: mockGoverned }));
vi.mock("@/lib/tak/agent-grants", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/tak/agent-grants")>(), getAgentToolGrantsAsync: mockGrants }));
const { mockLoadRoomTurnAuthority } = vi.hoisted(() => ({ mockLoadRoomTurnAuthority: vi.fn() }));
vi.mock("@/lib/work-management/room-turn-authority.server", () => ({ loadRoomTurnAuthority: mockLoadRoomTurnAuthority }));

const designDoc = { existingFunctionalityAudit: "audited item-body-baseline.ts", reusePlan: "extend it" };

describe("recordIdeateResearchReceipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGrants.mockResolvedValue(["initiative_evidence_write"]);
    mockPrisma.buildActivity.findFirst.mockResolvedValue(null);
    mockPrisma.buildActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.findUnique.mockResolvedValue({ originator: { itemId: "BI-660E165F" } });
    mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: true, groups: [] });
    mockPrisma.buildArtifactRevision.findFirst.mockResolvedValue({ id: "rev-42" });
    mockPrisma.workroom.findFirst.mockResolvedValue({ capsuleId: "WC-ROOM1" });
    mockLoadRoomTurnAuthority.mockResolvedValue({
      workroomId: "WC-ROOM1", collaborationShape: null, workShapeKey: null, authorizedGrants: null,
      actionBoundary: "preauthorized", participantRoles: null, memberOfRoom: true,
      externalAccess: { enabled: false, reason: "no-web-search-grant" }, handsOn: { enabled: true, reason: "room-action-boundary" },
      priority: null, prioritySource: null,
    });
  });

  it("holds a revoked writer instead of issuing another denied call, then rechecks restored authority", async () => {
    mockGrants.mockResolvedValue([]);
    mockGoverned.mockResolvedValue({ success: false, error: "authority_denied", message: "writer grant revoked" });
    const { recordIdeateResearchReceipt } = await import("./record-ideate-research-receipt");
    const args = { buildId: "FB-1", designDoc, revisionId: "x", authorUserId: "u-1", authorAgentId: "AGT-WS-BUILD" };
    expect(await recordIdeateResearchReceipt(args)).toMatchObject({ recorded: false, disposition: "held", attempted: false });
    expect(mockGoverned).not.toHaveBeenCalled();
    mockGrants.mockResolvedValue(["initiative_evidence_write"]);
    mockGoverned.mockResolvedValue({ success: true });
    expect((await recordIdeateResearchReceipt(args)).recorded).toBe(true);
    expect(mockGoverned).toHaveBeenCalledOnce();
  });

  it("carries the real build thread into the governed attestation", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({ originator: { itemId: "BI-660E165F" }, threadId: "actual-build-thread" });
    mockGoverned.mockResolvedValue({ success: true });
    const { recordIdeateResearchReceipt } = await import("./record-ideate-research-receipt");
    await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc, revisionId: "x", authorUserId: "u-1", authorAgentId: "AGT-WS-BUILD" });
    expect(mockGoverned.mock.calls[0][0].context.threadId).toBe("actual-build-thread");
  });

  it("uses the author's current roles and holds an inactive author", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [{ platformRole: { roleId: "platform-engineer" } }] });
    mockGoverned.mockResolvedValue({ success: true });
    const { recordIdeateResearchReceipt } = await import("./record-ideate-research-receipt");
    const args = { buildId: "FB-1", designDoc, revisionId: "x", authorUserId: "u-1", authorAgentId: "AGT-WS-BUILD" };
    await recordIdeateResearchReceipt(args);
    expect(mockGoverned.mock.calls[0][0].userContext).toMatchObject({ platformRole: "platform-engineer", platformRoles: ["platform-engineer"] });
    mockGoverned.mockClear();
    mockPrisma.user.findUnique.mockResolvedValue({ isActive: false, isSuperuser: true, groups: [] });
    expect(await recordIdeateResearchReceipt(args)).toMatchObject({ recorded: false, disposition: "held", attempted: false });
    expect(mockGoverned).not.toHaveBeenCalled();
  });

  it("retains an unchanged hold without duplicating the activity, and returns the refusal", async () => {
    mockGrants.mockResolvedValue([]);
    const { attestIdeateResearch } = await import("./record-ideate-research-receipt");
    const first = await attestIdeateResearch("FB-1", designDoc, "u-1", "AGT-WS-BUILD");
    expect(first).toMatchObject({ recorded: false, disposition: "held", attempted: false });
    const summary = mockPrisma.buildActivity.create.mock.calls[0][0].data.summary;
    mockPrisma.buildActivity.findFirst.mockResolvedValue({ summary });
    expect(await attestIdeateResearch("FB-1", designDoc, "u-1", "AGT-WS-BUILD")).toEqual(first);
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledOnce();
    expect(mockGoverned).not.toHaveBeenCalled();
  });

  it("preserves supplied task/thread attribution instead of inventing a task", async () => {
    mockGoverned.mockResolvedValue({ success: true });
    const { recordIdeateResearchReceipt } = await import("./record-ideate-research-receipt");
    await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc, revisionId: "x", authorUserId: "u-1", authorAgentId: "AGT-WS-BUILD",
      attribution: { threadId: "caller-thread", taskRunId: "caller-task" } });
    expect(mockGoverned.mock.calls[0][0].context).toMatchObject({ threadId: "caller-thread", taskRunId: "caller-task" });
  });

  it("records through the governed executor as AGT-WS-BUILD, bound to the accepted design revision", async () => {
    mockGoverned.mockResolvedValue({ success: true });
    const { recordIdeateResearchReceipt, IDEATE_ATTESTATION_AGENT_ID } = await import("./record-ideate-research-receipt");
    const out = await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc, revisionId: "review:FB-1", authorUserId: "u-1", authorAgentId: null });
    expect(out).toEqual({ recorded: true, reason: "research receipt recorded" });
    const call = mockGoverned.mock.calls[0][0];
    expect(call.toolName).toBe("record_initiative_evidence");
    expect(call.rawParams).toMatchObject({ itemId: "BI-660E165F", gate: "research", decision: "pass", artifactRef: { kind: "feature-build-revision", revisionId: "rev-42" } });
    // The gate-receipt schema requires both; a passing receipt sends them empty.
    expect(call.rawParams.findings).toEqual([]);
    expect(call.rawParams.resolvedFindingRefs).toEqual([]);
    expect(call.rawParams.reason).toContain("existingFunctionalityAudit");
    expect(call.context).toMatchObject({ agentId: IDEATE_ATTESTATION_AGENT_ID, featureBuildId: "FB-1", tokenScope: "write" });
    expect(call.userContext).toEqual({ userId: "u-1", platformRole: null, platformRoles: [], isSuperuser: true });
    // The build's Workroom authority travels on the call so a preauthorized
    // room steers the gate to "automated" instead of asking a person.
    expect(mockLoadRoomTurnAuthority).toHaveBeenCalledWith({ agentId: IDEATE_ATTESTATION_AGENT_ID, capsuleId: "WC-ROOM1" });
    expect(call.context.roomAuthority).toMatchObject({ workroomId: "WC-ROOM1", actionBoundary: "preauthorized", memberOfRoom: true });
    expect(call.context.routeContext).toBe("/build/work/WC-ROOM1");
  });

  it("still records without a room when the build has no Workroom", async () => {
    mockPrisma.workroom.findFirst.mockResolvedValue(null);
    mockGoverned.mockResolvedValue({ success: true });
    const { recordIdeateResearchReceipt } = await import("./record-ideate-research-receipt");
    const out = await recordIdeateResearchReceipt({ buildId: "FB-1", designDoc, revisionId: "x", authorUserId: "u-1", authorAgentId: null });
    expect(out.recorded).toBe(true);
    expect(mockGoverned.mock.calls[0][0].context.roomAuthority).toBeUndefined();
    expect(mockLoadRoomTurnAuthority).not.toHaveBeenCalled();
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
