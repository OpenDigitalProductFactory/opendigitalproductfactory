import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimGovernedBacklogWorkspace: vi.fn(),
  ensureCapsuleWorkItemAnchorWithPrisma: vi.fn(),
}));

vi.mock("./governed-work-claim", () => ({
  claimGovernedBacklogWorkspace: mocks.claimGovernedBacklogWorkspace,
}));

vi.mock("./capsule-workitem-anchor.server", () => ({
  ensureCapsuleWorkItemAnchorWithPrisma: mocks.ensureCapsuleWorkItemAnchorWithPrisma,
}));

import { claimBacklogItemForWork } from "./claim-backlog-item-handler";
import type { CapsuleDb } from "./work-capsule-store-types";

const okClaim = (capsuleId = "WC-SHAPE") => ({
  ok: true,
  data: {
    workIntent: "implementation",
    readiness: { verdict: "allowed" },
    readback: {},
    claim: { capsuleId, backlogItemId: "BI-ONE", headBranch: "fix/two", worktreePath: "/two", claimed: true, conflict: null },
  },
});

function shapeDb(item: Record<string, unknown> | null, scopeClaims: unknown = []) {
  return {
    backlogItem: { findFirst: vi.fn().mockResolvedValue(item), update: vi.fn() },
    workroom: {
      findUnique: vi.fn().mockResolvedValue({ scopeClaims }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    },
    workroomActivity: { create: vi.fn() },
  } as unknown as CapsuleDb;
}

describe("claimBacklogItemForWork MCP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCapsuleWorkItemAnchorWithPrisma.mockResolvedValue({});
  });

  it("threads a deliberate co-claim and its audit reason", async () => {
    mocks.claimGovernedBacklogWorkspace.mockResolvedValue({
      ok: true,
      data: {
        workIntent: "implementation",
        readiness: { verdict: "allowed" },
        readback: {},
        claim: { capsuleId: "WC-TWO", backlogItemId: "BI-ONE", headBranch: "fix/two", worktreePath: "/two", claimed: true, conflict: null },
      },
    });

    await claimBacklogItemForWork({
      params: { itemId: "BI-ONE", worktreePath: "/two", branchName: "fix/two", provider: "codex", sessionRef: "session-two", workShape: "delivery-small@1.0.0", force: true, overrideReason: "Split independent acceptance lanes." },
      userId: "user-1",
      context: { agentId: "AGT-AUTHOR" },
      db: {} as CapsuleDb,
      resolveActor: vi.fn().mockResolvedValue({ userId: "user-1", agentId: "AGT-AUTHOR", principalId: "PRN-1" }),
    });

    expect(mocks.claimGovernedBacklogWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ force: true, overrideReason: "Split independent acceptance lanes." }),
    }));
  });

  it("returns structured live owners when a duplicate claim is refused", async () => {
    const { BacklogItemAlreadyClaimedError } = await import("./backlog-workroom-ownership");
    const owner = { capsuleId: "WC-ONE", headBranch: "fix/one", worktreePath: "/one", executorKind: "codex-desktop", executorRef: "session-one", liveness: "live", isLive: true };
    mocks.claimGovernedBacklogWorkspace.mockRejectedValue(new BacklogItemAlreadyClaimedError("BI-ONE", [owner] as never));

    const result = await claimBacklogItemForWork({
      params: { itemId: "BI-ONE", worktreePath: "/two", branchName: "fix/two", provider: "codex", sessionRef: "session-two", workShape: "delivery-small@1.0.0" },
      userId: "user-1", context: { agentId: "AGT-AUTHOR" }, db: {} as CapsuleDb,
      resolveActor: vi.fn().mockResolvedValue({ userId: "user-1", agentId: "AGT-AUTHOR", principalId: "PRN-1" }),
    });

    expect(result).toMatchObject({ success: false, error: "backlog_item_already_claimed", data: { backlogItemId: "BI-ONE", liveWorkrooms: [owner] } });
  });

  it("preserves governed recovery on an initiative_not_ready result", async () => {
    const recovery = {
      reviewerRoutes: [{
        accountableRole: "design-checklist-reviewer",
        toolName: "record_initiative_design_review",
        grant: "initiative_design_review",
        gate: "spec-approval",
        targetAgentId: "AGT-WS-REVIEW",
        targetDisplayName: "Work Surface Reviewer",
        independent: true,
        workroomId: "WC-7FF8A505",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        branchName: "fix/initiative-readiness-traversal-recovery",
        headSha: "d47536a552c7d588b2f963e478ae99369f720783",
        requestCoworker: {
          targetAgent: "AGT-WS-REVIEW",
          objective: "Review the exact governed artifact.",
          questionPacketSummary: "spec-approval for BI-F0715C9C at d47536a552c",
          requestKey: "initiative-readiness:BI-F0715C9C:spec-approval:d47536a552c7d588b2f963e478ae99369f720783",
          tier: 2,
          enteredVia: "handoff",
        },
      }],
      escalations: [],
    };
    mocks.claimGovernedBacklogWorkspace.mockResolvedValue({
      ok: false,
      error: "Cannot start implementation: SPEC_APPROVAL_REQUIRED.",
      data: {
        code: "initiative_not_ready",
        workIntent: "implementation",
        readiness: { verdict: "input-required" },
        recovery,
      },
    });

    const result = await claimBacklogItemForWork({
      params: {
        itemId: "BI-F0715C9C",
        worktreePath: "D:/DPF-worktrees/initiative-readiness-recovery",
        branchName: "fix/initiative-readiness-traversal-recovery",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        provider: "codex",
        sessionRef: "session-1",
        workIntent: "implementation",
        workShape: "delivery-small@1.0.0",
      },
      userId: "user-1",
      context: { agentId: "AGT-AUTHOR" },
      db: {} as CapsuleDb,
      resolveActor: vi.fn().mockResolvedValue({ userId: "user-1", agentId: "AGT-AUTHOR", principalId: "PRN-1" }),
    });

    expect(result).toMatchObject({
      success: false,
      error: "initiative_not_ready",
      data: {
        workIntent: "implementation",
        readiness: { verdict: "input-required" },
        recovery,
      },
    });
  });
});

describe("the claim asks for the delivery shape (BI-02470C7E, design §3.3)", () => {
  const actor = vi.fn().mockResolvedValue({ userId: "user-1", agentId: "AGT-AUTHOR", principalId: "PRN-1" });
  const base = { itemId: "BI-ONE", worktreePath: "/two", branchName: "fix/two", provider: "claude", sessionRef: "session-two" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCapsuleWorkItemAnchorWithPrisma.mockResolvedValue({});
    mocks.claimGovernedBacklogWorkspace.mockResolvedValue(okClaim());
  });

  it("persists a declared shape on the Workroom as a workShape scope claim with source declared", async () => {
    const db = shapeDb({ effortSize: null, workType: "feature", title: "t", body: "" }, [{ kind: "path", value: "apps/web", intent: "edit" }]);
    const result = await claimBacklogItemForWork({ params: { ...base, workShape: "delivery-medium@1.0.0" }, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).workShape).toEqual({ ref: "delivery-medium@1.0.0", source: "declared" });
    expect((db.workroom.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      where: { capsuleId: "WC-SHAPE" },
      data: { scopeClaims: [
        { kind: "path", value: "apps/web", intent: "edit" },
        expect.objectContaining({ workShape: "delivery-medium@1.0.0", source: "declared" }),
      ] },
    });
  });

  it("preserves legacy scope metadata when binding a delivery shape", async () => {
    const db = shapeDb({ effortSize: "small", workType: "chore", title: "tidy", body: "" }, { workShapeKey: "delivery-medium", workShapeVersion: "1.0.0", extension: "retained" });
    await claimBacklogItemForWork({ params: base, userId: "user-1", context: {}, db, resolveActor: actor });
    expect((db.workroom.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({ data: { scopeClaims: [
      { extension: "retained" }, expect.objectContaining({ workShape: "delivery-small@1.0.0", source: "derived" }),
    ] } });
  });

  it("does not rewrite an unchanged delivery binding on claim replay", async () => {
    const db = shapeDb({ effortSize: "small", workType: "chore", title: "tidy", body: "" }, [{ workShape: "delivery-small@1.0.0", recordedAt: "original" }]);
    await claimBacklogItemForWork({ params: base, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(db.workroom.update).not.toHaveBeenCalled();
  });

  it("derives the shape when the rules agree and records the signals", async () => {
    const db = shapeDb({ effortSize: "small", workType: "chore", title: "tidy", body: "" });
    const result = await claimBacklogItemForWork({ params: base, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).workShape).toMatchObject({ ref: "delivery-small@1.0.0", source: "derived", reasonCode: "derived_effort_size" });
    expect((db.workroom.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      data: { scopeClaims: [expect.objectContaining({ workShape: "delivery-small@1.0.0", source: "derived", signals: expect.objectContaining({ workType: "chore" }) })] },
    });
  });

  it("refuses an implementation claim with no derivable shape and carries the five-shape pick list", async () => {
    const db = shapeDb({ effortSize: null, workType: "feature", title: "a feature", body: "" });
    const result = await claimBacklogItemForWork({ params: base, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(result).toMatchObject({ success: false, error: "work_shape_required" });
    const pickList = (result.data as { pickList: Array<{ ref: string; appetite: string; owes: string }> }).pickList;
    expect(pickList.map((entry) => entry.ref)).toEqual([
      "delivery-break-fix@1.0.0", "delivery-small@1.0.0", "delivery-medium@1.0.0", "delivery-large@1.0.0", "delivery-xlarge@1.0.0",
    ]);
    expect(pickList.every((entry) => entry.appetite && entry.owes)).toBe(true);
    expect(mocks.claimGovernedBacklogWorkspace).not.toHaveBeenCalled();
  });

  it("flags attention for an unattended executor instead of waiting for an answer", async () => {
    const db = shapeDb({ effortSize: null, workType: "feature", title: "a feature", body: "" });
    const result = await claimBacklogItemForWork({ params: { ...base, provider: "build-studio" }, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(result).toMatchObject({ success: false, error: "work_shape_required", data: { attentionRequired: true } });
  });

  it("lets a plan claim proceed unshaped when nothing is derivable", async () => {
    const db = shapeDb({ effortSize: null, workType: "feature", title: "a feature", body: "" });
    const result = await claimBacklogItemForWork({ params: { ...base, workIntent: "plan" }, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).workShape).toBeNull();
    expect(db.workroom.update).not.toHaveBeenCalled();
  });

  it("never lets xlarge enter implementation", async () => {
    const db = shapeDb({ effortSize: "xlarge", workType: "feature", title: "an initiative", body: "" });
    const result = await claimBacklogItemForWork({ params: base, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(result).toMatchObject({ success: false, error: "work_shape_xlarge_requires_decomposition" });
    const declared = await claimBacklogItemForWork({ params: { ...base, workShape: "delivery-xlarge@1.0.0" }, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(declared).toMatchObject({ success: false, error: "work_shape_xlarge_requires_decomposition" });
  });

  it("refuses a malformed shape reference", async () => {
    const db = shapeDb({ effortSize: "small", workType: "chore", title: "t", body: "" });
    const result = await claimBacklogItemForWork({ params: { ...base, workShape: "delivery-small" }, userId: "user-1", context: {}, db, resolveActor: actor });
    expect(result).toMatchObject({ success: false, error: "invalid_work_shape" });
  });
});
