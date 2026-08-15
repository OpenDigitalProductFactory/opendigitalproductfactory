import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({
  revalidatePortalContext: vi.fn(),
}));

import {
  adoptWorktreeCapsule,
  claimBacklogItemWorkspace,
  claimWorkCapsuleScope,
  createWorkCapsule,
  detectScopeConflicts,
  heartbeatWorkCapsule,
  reassignWorkCapsuleExecutor,
  planCapsuleWorkspace,
  recordWorkCapsuleEvidence,
  recordAgentActivity,
  ScopeOverlapError,
  type CapsuleDb,
} from "./work-capsule-store";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";

const db = {
  workCapsule: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  workCapsuleActivity: {
    create: vi.fn(),
  },
  backlogItem: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};
const mockRevalidatePortalContext = revalidatePortalContext as ReturnType<typeof vi.fn>;

function resetDbMocks() {
  db.workCapsule.create.mockReset();
  db.workCapsule.findFirst.mockReset();
  db.workCapsule.findUnique.mockReset();
  db.workCapsule.findMany.mockReset();
  db.workCapsule.update.mockReset();
  db.workCapsuleActivity.create.mockReset();
  db.backlogItem.findFirst.mockReset();
  db.backlogItem.update.mockReset();
  db.$transaction.mockReset();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  mockRevalidatePortalContext.mockReset();
}

function capsuleDb(): CapsuleDb {
  return db as unknown as CapsuleDb;
}

describe("work capsule store", () => {
  beforeEach(() => resetDbMocks());

  it("creates a capsule on first call and writes a single created activity", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce(null);
    db.workCapsule.create.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-ABC12345",
      title: "Work control",
    });

    const result = await createWorkCapsule({
      db: capsuleDb(),
      input: {
        title: "Work control",
        objective: "Adopt current worktrees.",
        source: "manual",
        idempotencyKey: "manual:work-control",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-ABC12345");
    expect(db.workCapsule.create).toHaveBeenCalledTimes(1);
    expect(db.workCapsuleActivity.create).toHaveBeenCalledTimes(1);
    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "created" }),
    }));
  });

  it("persists scope metadata when creating a backlog-free company capsule", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce(null);
    db.workCapsule.create.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-SCOPED",
      title: "Customer onboarding",
    });

    const result = await createWorkCapsule({
      db: capsuleDb(),
      input: {
        title: "Customer onboarding",
        objective: "Coordinate a customer onboarding work case.",
        source: "manual",
        idempotencyKey: "manual:customer-onboarding",
        scope: {
          decisionScope: "wwwd",
          portfolioRole: "productsAndServicesSold",
          servedPersona: " customer ",
          activityKind: "delivery",
          outcomeAnchor: { kind: "work-case", id: "CASE-123", label: " Onboard Contoso " },
          servesPortfolioRoles: ["productsAndServicesSold", "manufactureAndDeliver"],
          dependsOnPortfolioRoles: ["foundational"],
        },
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-SCOPED");
    expect(db.workCapsule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        backlogItemId: null,
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
        servedPersona: "customer",
        activityKind: "delivery",
        outcomeAnchor: { kind: "work-case", id: "CASE-123", label: "Onboard Contoso" },
        servesPortfolioRoles: ["productsAndServicesSold", "manufactureAndDeliver"],
        dependsOnPortfolioRoles: ["foundational"],
      }),
    }));
  });

  it("persists a first-class Requester distinct from the creating actor (BI-B24F96D0)", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce(null);
    db.workCapsule.create.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-REQ", title: "Commissioned work" });

    await createWorkCapsule({
      db: capsuleDb(),
      input: {
        title: "Commissioned work",
        objective: "Build the thing the founder asked for.",
        source: "manual",
        idempotencyKey: "manual:commissioned",
        requestedByPrincipalId: "principal-requester",
      },
      actor: { userId: "worker-1", agentId: "agent-1", principalId: "principal-worker" },
    });

    expect(db.workCapsule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        createdByPrincipalId: "principal-worker",
        requestedByPrincipalId: "principal-requester",
      }),
    }));
  });

  it("defaults the Requester to null when not supplied", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce(null);
    db.workCapsule.create.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-NOREQ", title: "Self-started" });

    await createWorkCapsule({
      db: capsuleDb(),
      input: {
        title: "Self-started",
        objective: "Agent started this on its own.",
        source: "manual",
        idempotencyKey: "manual:self-started",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(db.workCapsule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestedByPrincipalId: null }),
    }));
  });

  it("rejects invalid scope metadata before creating a capsule", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce(null);

    await expect(createWorkCapsule({
      db: capsuleDb(),
      input: {
        title: "Bad scope",
        objective: "Should not persist.",
        source: "manual",
        idempotencyKey: "manual:bad-scope",
        scope: { portfolioRole: "sales" },
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    })).rejects.toThrow(/portfolioRole/i);

    expect(db.workCapsule.create).not.toHaveBeenCalled();
    expect(db.workCapsuleActivity.create).not.toHaveBeenCalled();
  });

  it("returns the existing capsule on idempotent retry without writing a duplicate activity", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-ABC12345",
      title: "Work control",
    });

    const result = await createWorkCapsule({
      db: capsuleDb(),
      input: {
        title: "Work control",
        objective: "Adopt current worktrees.",
        source: "manual",
        idempotencyKey: "manual:work-control",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-ABC12345");
    expect(db.workCapsule.create).not.toHaveBeenCalled();
    expect(db.workCapsuleActivity.create).not.toHaveBeenCalled();
  });

  it("adopts an existing worktree by repository and branch", async () => {
    db.workCapsule.findFirst.mockResolvedValue(null);
    db.workCapsule.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-ADOPT01" });

    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Adopt feature branch",
        objective: "Recover work in flight.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/recovery",
        worktreePath: "D:/DPF-recovery",
        baseBranch: "main",
        baseSha: "base",
        headSha: "head",
        executorKind: "codex-desktop",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-ADOPT01");
    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "adopted" }),
    }));
  });

  it("persists scope metadata when adopting a platform worktree", async () => {
    db.workCapsule.findFirst.mockResolvedValue(null);
    db.workCapsule.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-ADOPTSCOPE" });

    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Adopt Work Capsule scope branch",
        objective: "Implement platform scope metadata.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/layer-scoped-work-capsules",
        worktreePath: "D:/DPF-worktrees/layer-scoped-work-capsules",
        executorKind: "codex-desktop",
        scope: {
          decisionScope: "wwmd",
          portfolioRole: "manufactureAndDeliver",
          servedPersona: "platform-team",
          activityKind: "improvement",
          outcomeAnchor: { kind: "backlog-item", id: "BI-5F70A7DA" },
        },
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-ADOPTSCOPE");
    expect(db.workCapsule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        decisionScope: "wwmd",
        portfolioRole: "manufactureAndDeliver",
        servedPersona: "platform-team",
        activityKind: "improvement",
        outcomeAnchor: { kind: "backlog-item", id: "BI-5F70A7DA" },
      }),
    }));
  });

  it("renews a lease on heartbeat", async () => {
    db.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-LEASE" });

    const result = await heartbeatWorkCapsule({
      db: capsuleDb(),
      capsuleId: "WC-LEASE",
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
      now: new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(result.capsuleId).toBe("WC-LEASE");
    expect(db.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseHolderPrincipalId: "principal-1" }),
    }));
  });

  it("records evidence append-only", async () => {
    db.workCapsule.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-EVIDENCE" });
    db.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    await recordWorkCapsuleEvidence({
      db: capsuleDb(),
      capsuleId: "WC-EVIDENCE",
      evidence: { kind: "test", summary: "Vitest passed", command: "pnpm --filter web test" },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "evidence-recorded",
        summary: "Vitest passed",
      }),
    }));
    expect(mockRevalidatePortalContext).toHaveBeenCalledTimes(1);
  });

  it("records runtime evidence links in the capsule activity payload", async () => {
    db.workCapsule.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-EVIDENCE" });
    db.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    await recordWorkCapsuleEvidence({
      db: capsuleDb(),
      capsuleId: "WC-EVIDENCE",
      evidence: {
        kind: "verification",
        summary: "Sandbox UX passed",
        targetId: "RT-SANDBOX-1",
        runtimeTargetId: "target-row-1",
        verificationId: "RV-UX-1",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "evidence-recorded",
        payload: expect.objectContaining({
          targetId: "RT-SANDBOX-1",
          runtimeTargetId: "target-row-1",
          verificationId: "RV-UX-1",
        }),
      }),
    }));
  });

  describe("planCapsuleWorkspace", () => {
    it("persists deterministic branch + worktree path on first plan and writes a workspace-planned activity", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0001",
        title: "Provider routing tool capability",
        status: "draft",
        baseBranch: null,
        headBranch: null,
        worktreePath: null,
      });
      db.workCapsule.findFirst.mockResolvedValueOnce(null);
      db.workCapsule.update.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0001",
        headBranch: "feat/provider-routing-tool-capability",
        worktreePath: "D:\\DPF-provider-routing-tool-capability",
        branchTaxonomy: "feat",
      });

      const result = await planCapsuleWorkspace({
        db: capsuleDb(),
        capsuleId: "WC-PLAN0001",
        taxonomy: "feat",
        os: "win32",
        home: "/Users/mark",
        existingBranches: new Set(),
        actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
      });

      expect(result.headBranch).toBe("feat/provider-routing-tool-capability");
      expect(result.worktreePath).toBe("D:\\DPF-provider-routing-tool-capability");
      expect(db.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          baseBranch: "main",
          branchTaxonomy: "feat",
          status: "ready",
        }),
      }));
      expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: "workspace-planned" }),
        }),
      );
    });

    it("returns the existing plan on idempotent re-plan without writing a second activity", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0002",
        title: "Provider routing tool capability",
        headBranch: "feat/provider-routing-tool-capability",
        worktreePath: "D:\\DPF-provider-routing-tool-capability",
        branchTaxonomy: "feat",
      });

      const result = await planCapsuleWorkspace({
        db: capsuleDb(),
        capsuleId: "WC-PLAN0002",
        taxonomy: "feat",
        os: "win32",
        home: "/Users/mark",
        existingBranches: new Set(),
        actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
      });

      expect(result.headBranch).toBe("feat/provider-routing-tool-capability");
      expect(db.workCapsule.update).not.toHaveBeenCalled();
      expect(db.workCapsuleActivity.create).not.toHaveBeenCalled();
    });

    it("throws on partial-plan state when only one workspace field is set", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PARTIAL",
        title: "Half written",
        headBranch: "feat/half-written",
        worktreePath: null,
      });

      await expect(
        planCapsuleWorkspace({
          db: capsuleDb(),
          capsuleId: "WC-PARTIAL",
          taxonomy: "feat",
          os: "win32",
          home: "/Users/mark",
          existingBranches: new Set(),
          actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
        }),
      ).rejects.toThrow(/partial-plan state/i);
    });

    it("refuses to propose the root clone as the worktree path", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0003",
        title: "Danger",
        status: "draft",
        baseBranch: null,
        headBranch: null,
        worktreePath: null,
      });
      db.workCapsule.findFirst.mockResolvedValueOnce(null);

      await expect(
        planCapsuleWorkspace({
          db: capsuleDb(),
          capsuleId: "WC-PLAN0003",
          taxonomy: "feat",
          os: "win32",
          home: "/Users/mark",
          releaseOverride: "D:\\DPF-danger",
          existingBranches: new Set(),
          actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
        }),
      ).rejects.toThrow(/root clone/i);
    });

    it("appends a numeric suffix when the slug collides with an existing branch", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0004",
        title: "Work capsule",
        status: "draft",
        baseBranch: null,
        headBranch: null,
        worktreePath: null,
      });
      db.workCapsule.findFirst.mockResolvedValueOnce(null);
      db.workCapsule.update.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0004",
        headBranch: "feat/work-capsule-2",
        worktreePath: "D:\\DPF-work-capsule-2",
        branchTaxonomy: "feat",
      });

      const result = await planCapsuleWorkspace({
        db: capsuleDb(),
        capsuleId: "WC-PLAN0004",
        taxonomy: "feat",
        os: "win32",
        home: "/Users/mark",
        existingBranches: new Set(["feat/work-capsule"]),
        actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
      });

      expect(result.headBranch).toBe("feat/work-capsule-2");
    });

    it("appends a numeric suffix when another active capsule already owns the branch", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0005",
        title: "Owned elsewhere",
        status: "draft",
        baseBranch: null,
        headBranch: null,
        worktreePath: null,
      });
      db.workCapsule.findFirst
        .mockResolvedValueOnce({ id: "row-other", capsuleId: "WC-OTHER" })
        .mockResolvedValueOnce(null);
      db.workCapsule.update.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-PLAN0005",
        headBranch: "feat/owned-elsewhere-2",
        worktreePath: "D:\\DPF-owned-elsewhere-2",
        branchTaxonomy: "feat",
      });

      const result = await planCapsuleWorkspace({
        db: capsuleDb(),
        capsuleId: "WC-PLAN0005",
        taxonomy: "feat",
        os: "win32",
        home: "/Users/mark",
        existingBranches: new Set(),
        actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
      });

      expect(result.headBranch).toBe("feat/owned-elsewhere-2");
    });
  });

  describe("claimBacklogItemWorkspace", () => {
    const baseInput = {
      backlogItemId: "BI-7D20BFDF",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "feat/bi-work-location-claim",
      worktreePath: "/Users/mark/dpf-wt/bi-work-location",
      executorKind: "codex-desktop" as const,
      executorRef: "session-A",
    };
    const actor = { userId: "user-1", agentId: "agent-1", principalId: "PRN-1" };

    it("throws a clear error when the BacklogItem does not exist", async () => {
      db.backlogItem.findFirst.mockResolvedValueOnce(null);
      await expect(
        claimBacklogItemWorkspace({ db: capsuleDb(), input: baseInput, actor }),
      ).rejects.toThrow(/BI-7D20BFDF not found/i);
    });

    it("binds the capsule and stamps the BI claim when unclaimed", async () => {
      db.backlogItem.findFirst.mockResolvedValueOnce({
        id: "bi-row-1",
        itemId: "BI-7D20BFDF",
        epicId: "EP-1",
        claimStatus: null,
        claimedById: null,
        claimedByAgentId: null,
        claimedAt: null,
      });
      db.workCapsule.findFirst.mockResolvedValueOnce(null); // adopt: no existing
      db.workCapsule.create.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-CLAIM01",
        headBranch: baseInput.headBranch,
        worktreePath: baseInput.worktreePath,
      });
      db.workCapsule.findMany.mockResolvedValueOnce([]); // no other locations
      db.backlogItem.update.mockResolvedValueOnce({ id: "bi-row-1" });

      const result = await claimBacklogItemWorkspace({ db: capsuleDb(), input: baseInput, actor });

      expect(result.capsuleId).toBe("WC-CLAIM01");
      expect(result.claimed).toBe(true);
      expect(result.conflict).toBeNull();
      expect(db.backlogItem.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          claimStatus: "active",
          claimedById: "user-1",
          claimedByAgentId: "agent-1",
        }),
      }));
    });

    it("resumes the durable abandoned capsule when the same BI reclaims its branch", async () => {
      db.backlogItem.findFirst.mockResolvedValueOnce({
        id: "bi-row-1",
        itemId: "BI-7D20BFDF",
        epicId: "EP-1",
        claimStatus: "active",
        claimedById: "user-1",
        claimedByAgentId: "agent-1",
        claimedAt: new Date(),
      });
      db.workCapsule.findFirst.mockResolvedValueOnce({
        id: "row-abandoned",
        capsuleId: "WC-CLAIM01",
        status: "abandoned",
        archivedAt: null,
        backlogItemId: "BI-7D20BFDF",
        epicId: "EP-1",
        executorKind: "codex-desktop",
        executorRef: "session-old",
        baseBranch: "main",
        headBranch: baseInput.headBranch,
        worktreePath: baseInput.worktreePath,
      });
      db.workCapsule.update.mockResolvedValueOnce({
        id: "row-abandoned",
        capsuleId: "WC-CLAIM01",
        status: "ready",
        backlogItemId: "BI-7D20BFDF",
        headBranch: baseInput.headBranch,
        worktreePath: baseInput.worktreePath,
      });
      db.workCapsule.findMany.mockResolvedValueOnce([]);
      db.backlogItem.update.mockResolvedValueOnce({ id: "bi-row-1" });

      const result = await claimBacklogItemWorkspace({ db: capsuleDb(), input: baseInput, actor });

      expect(result.capsuleId).toBe("WC-CLAIM01");
      expect(result.claimed).toBe(true);
      expect(db.workCapsule.create).not.toHaveBeenCalled();
      expect(db.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { capsuleId: "WC-CLAIM01" },
        data: expect.objectContaining({
          status: "ready",
          executorRef: "session-A",
          leaseHolderPrincipalId: "PRN-1",
        }),
      }));
    });

    it("returns a non-blocking conflict and does NOT overwrite a fresh claim held by another agent", async () => {
      const now = new Date("2026-07-06T12:00:00.000Z");
      db.backlogItem.findFirst.mockResolvedValueOnce({
        id: "bi-row-1",
        itemId: "BI-7D20BFDF",
        epicId: null,
        claimStatus: "active",
        claimedById: "other-user",
        claimedByAgentId: "other-agent",
        claimedAt: new Date(now.getTime() - 60 * 60 * 1000), // 1h ago = fresh
      });
      db.workCapsule.findFirst.mockResolvedValueOnce(null);
      db.workCapsule.create.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-CLAIM02",
        headBranch: baseInput.headBranch,
        worktreePath: baseInput.worktreePath,
      });
      db.workCapsule.findMany.mockResolvedValueOnce([]);

      const result = await claimBacklogItemWorkspace({ db: capsuleDb(), input: baseInput, actor, now });

      // Capsule still bound (soft claim), but the BI claim is untouched.
      expect(result.capsuleId).toBe("WC-CLAIM02");
      expect(result.claimed).toBe(false);
      expect(db.backlogItem.update).not.toHaveBeenCalled();
      expect(result.conflict?.backlogClaim).toMatchObject({
        claimedByAgentId: "other-agent",
        claimAgeMinutes: 60,
      });
    });

    it("reclaims a STALE (>12h) claim held by another agent", async () => {
      const now = new Date("2026-07-06T12:00:00.000Z");
      db.backlogItem.findFirst.mockResolvedValueOnce({
        id: "bi-row-1",
        itemId: "BI-7D20BFDF",
        epicId: null,
        claimStatus: "active",
        claimedById: "other-user",
        claimedByAgentId: "other-agent",
        claimedAt: new Date(now.getTime() - 13 * 60 * 60 * 1000), // 13h ago = stale
      });
      db.workCapsule.findFirst.mockResolvedValueOnce(null);
      db.workCapsule.create.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-CLAIM03" });
      db.workCapsule.findMany.mockResolvedValueOnce([]);
      db.backlogItem.update.mockResolvedValueOnce({ id: "bi-row-1" });

      const result = await claimBacklogItemWorkspace({ db: capsuleDb(), input: baseInput, actor, now });

      expect(result.claimed).toBe(true);
      expect(result.conflict).toBeNull();
      expect(db.backlogItem.update).toHaveBeenCalledTimes(1);
    });

    it("allows a second capsule on a different branch for the same BI without a blocking claim conflict", async () => {
      db.backlogItem.findFirst.mockResolvedValueOnce({
        id: "bi-row-1",
        itemId: "BI-7D20BFDF",
        epicId: null,
        claimStatus: null,
        claimedById: null,
        claimedByAgentId: null,
        claimedAt: null,
      });
      db.workCapsule.findFirst.mockResolvedValueOnce(null);
      db.workCapsule.create.mockResolvedValueOnce({
        id: "row-2",
        capsuleId: "WC-CLAIM-B",
        headBranch: "feat/second-branch",
      });
      // Another capsule already exists on a DIFFERENT branch for the same BI.
      db.workCapsule.findMany.mockResolvedValueOnce([
        { capsuleId: "WC-CLAIM-A", headBranch: "feat/first-branch", worktreePath: "/wt/a", executorRef: "session-B", leaseHolderPrincipalId: "PRN-2" },
      ]);
      db.backlogItem.update.mockResolvedValueOnce({ id: "bi-row-1" });

      const result = await claimBacklogItemWorkspace({
        db: capsuleDb(),
        input: { ...baseInput, headBranch: "feat/second-branch" },
        actor,
      });

      // The second branch still claims the BI (no other fresh BI claim) and binds,
      // but the other in-flight location is surfaced as advisory conflict metadata.
      expect(result.claimed).toBe(true);
      expect(result.conflict?.backlogClaim).toBeNull();
      expect(result.conflict?.otherLocations).toHaveLength(1);
      expect(result.conflict?.otherLocations[0]?.capsuleId).toBe("WC-CLAIM-A");
    });

    it("is idempotent: reusing the same branch returns the existing capsule (no duplicate create)", async () => {
      db.backlogItem.findFirst.mockResolvedValueOnce({
        id: "bi-row-1",
        itemId: "BI-7D20BFDF",
        epicId: null,
        claimStatus: "active",
        claimedById: "user-1", // owned by caller
        claimedByAgentId: "agent-1",
        claimedAt: new Date(),
      });
      // adopt reuse: existing capsule already bound to this BI + session.
      db.workCapsule.findFirst.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-CLAIM01",
        status: "working",
        backlogItemId: "BI-7D20BFDF",
        epicId: null,
        executorRef: "session-A",
        headBranch: baseInput.headBranch,
        worktreePath: baseInput.worktreePath,
      });
      db.workCapsule.findMany.mockResolvedValueOnce([]);
      db.backlogItem.update.mockResolvedValueOnce({ id: "bi-row-1" });

      const result = await claimBacklogItemWorkspace({ db: capsuleDb(), input: baseInput, actor });

      expect(result.capsuleId).toBe("WC-CLAIM01");
      expect(db.workCapsule.create).not.toHaveBeenCalled();
      expect(db.workCapsule.update).not.toHaveBeenCalled(); // already bound → no late-bind
    });
  });

  describe("claimWorkCapsuleScope scope-overlap rejection", () => {
    const actor = { userId: "user-1", agentId: "agent-1", principalId: "PRN-1" };

    function otherCapsule(overrides: Record<string, unknown>) {
      return {
        capsuleId: "WC-OTHER01",
        title: "Other session",
        leaseHolderPrincipalId: "PRN-2",
        scopeClaims: [
          {
            kind: "path",
            value: "apps/web/lib/foo.ts",
            intent: "edit",
            recordedAt: "2026-06-18T00:00:00.000Z",
            recordedByPrincipalId: "PRN-2",
          },
        ],
        ...overrides,
      };
    }

    it("rejects an edit claim that overlaps another active capsule's edit claim", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-MINE001",
        status: "working",
        archivedAt: null,
        scopeClaims: [],
      });
      db.workCapsule.findMany.mockResolvedValueOnce([otherCapsule({})]);

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);

      // The conflicting write must never reach the DB.
      expect(db.workCapsule.update).not.toHaveBeenCalled();
    });

    it("refuses scope claims on an abandoned capsule (BI-95E37EA1)", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-stale",
        capsuleId: "WC-DEAC865E",
        status: "abandoned",
        archivedAt: null,
        scopeClaims: [],
      });

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-DEAC865E",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "read" }],
          actor,
        }),
      ).rejects.toThrow(/abandoned and cannot accept scope claims/i);

      expect(db.workCapsule.update).not.toHaveBeenCalled();
    });

    it("rejects an edit claim that overlaps another capsule's read claim (edit is exclusive)", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001", scopeClaims: [] });
      db.workCapsule.findMany.mockResolvedValueOnce([
        otherCapsule({ scopeClaims: [{ kind: "module", value: "routing", intent: "read", recordedAt: "2026-06-18T00:00:00.000Z", recordedByPrincipalId: "PRN-2" }] }),
      ]);

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "module", value: "routing", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);
    });

    it("allows two read claims on the same scope (read is non-exclusive)", async () => {
      db.workCapsule.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-MINE001", scopeClaims: [] });
      db.workCapsule.findMany.mockResolvedValueOnce([
        otherCapsule({ scopeClaims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "read", recordedAt: "2026-06-18T00:00:00.000Z", recordedByPrincipalId: "PRN-2" }] }),
      ]);
      db.workCapsule.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workCapsuleActivity.create.mockResolvedValueOnce({ id: "act-1" });

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "read" }],
          actor,
        }),
      ).resolves.toBeDefined();
      expect(db.workCapsule.update).toHaveBeenCalledTimes(1);
    });

    it("allows a claim when no other capsule holds overlapping scope", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001", scopeClaims: [] });
      db.workCapsule.findMany.mockResolvedValueOnce([]);
      db.workCapsule.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workCapsuleActivity.create.mockResolvedValueOnce({ id: "act-1" });

      const result = await claimWorkCapsuleScope({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/bar.ts", intent: "edit" }],
        actor,
      });
      expect(result.capsuleId).toBe("WC-MINE001");
      expect(db.workCapsule.update).toHaveBeenCalledTimes(1);
    });

    it("force=true co-claims despite a conflict and records the override on the activity log", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001", scopeClaims: [] });
      db.workCapsule.findMany.mockResolvedValueOnce([otherCapsule({})]);
      db.workCapsule.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workCapsuleActivity.create.mockResolvedValueOnce({ id: "act-1" });

      await claimWorkCapsuleScope({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
        actor,
        force: true,
      });

      expect(db.workCapsule.update).toHaveBeenCalledTimes(1);
      const activityArg = db.workCapsuleActivity.create.mock.calls[0]![0] as {
        data: { payload: { forcedOverConflicts?: unknown[] } };
      };
      expect(activityArg.data.payload.forcedOverConflicts).toHaveLength(1);
    });

    it("rejects an edit on a file beneath another capsule's directory path claim", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001", scopeClaims: [] });
      db.workCapsule.findMany.mockResolvedValueOnce([
        otherCapsule({
          scopeClaims: [{ kind: "path", value: "apps/web/lib/", intent: "edit", recordedAt: "2026-06-18T00:00:00.000Z", recordedByPrincipalId: "PRN-2" }],
        }),
      ]);

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);
      expect(db.workCapsule.update).not.toHaveBeenCalled();
    });

    it("rejects an edit directory claim that contains another capsule's file claim", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001", scopeClaims: [] });
      db.workCapsule.findMany.mockResolvedValueOnce([otherCapsule({})]); // holds apps/web/lib/foo.ts (edit)

      await expect(
        claimWorkCapsuleScope({
          db: capsuleDb(),
          capsuleId: "WC-MINE001",
          claims: [{ kind: "path", value: "apps/web", intent: "edit" }],
          actor,
        }),
      ).rejects.toBeInstanceOf(ScopeOverlapError);
    });

    it("does not treat a sibling path sharing a string prefix as overlapping", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001", scopeClaims: [] });
      db.workCapsule.findMany.mockResolvedValueOnce([otherCapsule({})]); // holds apps/web/lib/foo.ts (edit)
      db.workCapsule.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-MINE001" });
      db.workCapsuleActivity.create.mockResolvedValueOnce({ id: "act-1" });

      const result = await claimWorkCapsuleScope({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/foobar.ts", intent: "edit" }],
        actor,
      });
      expect(result.capsuleId).toBe("WC-MINE001");
      expect(db.workCapsule.update).toHaveBeenCalledTimes(1);
    });

    it("scopes the conflict query to active, non-terminal, unexpired, non-self capsules", async () => {
      db.workCapsule.findMany.mockResolvedValueOnce([]);
      const now = new Date("2026-06-18T12:00:00.000Z");

      await detectScopeConflicts({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [{ kind: "path", value: "apps/web/lib/foo.ts", intent: "edit" }],
        now,
      });

      const where = db.workCapsule.findMany.mock.calls[0]![0].where;
      expect(where.capsuleId).toEqual({ not: "WC-MINE001" });
      expect(where.archivedAt).toBeNull();
      expect(where.status.notIn).toEqual(expect.arrayContaining(["complete", "abandoned", "archived"]));
      expect(where.OR).toEqual([{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: now } }]);
    });

    it("returns no conflicts for an empty claim list without querying", async () => {
      const conflicts = await detectScopeConflicts({
        db: capsuleDb(),
        capsuleId: "WC-MINE001",
        claims: [],
      });
      expect(conflicts).toEqual([]);
      expect(db.workCapsule.findMany).not.toHaveBeenCalled();
    });
  });

  describe("reassignWorkCapsuleExecutor cross-agent handoff (BI-A443B9CC)", () => {
    it("changes the executor, transfers the lease, and writes an executor-changed activity with provenance", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce({
        id: "row-1",
        executorKind: "claude-desktop",
        executorRef: "claude-session",
        leaseHolderPrincipalId: "principal-claude",
      });
      db.workCapsule.update.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-HANDOFF" });

      await reassignWorkCapsuleExecutor({
        db: capsuleDb(),
        capsuleId: "WC-HANDOFF",
        toExecutorKind: "grok-desktop",
        toExecutorRef: "grok-session",
        reason: "Claude blocked on rate limit",
        handoffManifest: { nextAction: "finish the migration", openRisks: ["untested edge case"] },
        actor: { userId: "user-1", agentId: "grok", principalId: "principal-grok" },
      });

      // executor + lease transferred to the receiving principal
      expect(db.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { capsuleId: "WC-HANDOFF" },
        data: expect.objectContaining({
          executorKind: "grok-desktop",
          executorRef: "grok-session",
          leaseHolderPrincipalId: "principal-grok",
        }),
      }));
      // executor-changed activity carries full from/to provenance + manifest
      expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          kind: "executor-changed",
          payload: expect.objectContaining({
            fromExecutorKind: "claude-desktop",
            toExecutorKind: "grok-desktop",
            fromLeaseHolderPrincipalId: "principal-claude",
            toLeaseHolderPrincipalId: "principal-grok",
            reason: "Claude blocked on rate limit",
            handoffManifest: { nextAction: "finish the migration", openRisks: ["untested edge case"] },
          }),
        }),
      }));
    });

    it("rejects an invalid target executor kind before mutating", async () => {
      await expect(reassignWorkCapsuleExecutor({
        db: capsuleDb(),
        capsuleId: "WC-HANDOFF",
        toExecutorKind: "not-a-real-executor" as never,
        actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
      })).rejects.toThrow(/executor kind/i);
      expect(db.workCapsule.update).not.toHaveBeenCalled();
    });

    it("throws when the capsule does not exist", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce(null);
      await expect(reassignWorkCapsuleExecutor({
        db: capsuleDb(),
        capsuleId: "WC-MISSING",
        toExecutorKind: "codex-desktop",
        actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
      })).rejects.toThrow(/not found/i);
      expect(db.workCapsule.update).not.toHaveBeenCalled();
    });
  });

  describe("recordAgentActivity teammate-session feed (BI-C41AB195)", () => {
    it.each(["thought", "action", "question", "response", "error"] as const)(
      "writes a %s activity onto the capsule timeline with actor identity",
      async (type) => {
        db.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-SESS" });
        db.workCapsuleActivity.create.mockResolvedValueOnce({ id: "act-1" });

        await recordAgentActivity({
          db: capsuleDb(),
          capsuleId: "WC-SESS",
          activity: { type, body: `did a ${type}`, payload: { subtaskRef: "sub-1" } },
          actor: { userId: "user-1", agentId: "claude", principalId: "principal-1" },
        });

        expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            workCapsuleId: "row-1",
            kind: type,
            summary: `did a ${type}`,
            payload: { subtaskRef: "sub-1" },
            recordedByAgentId: "claude",
          }),
        }));
      },
    );

    it("rejects an invalid activity type before touching the capsule", async () => {
      await expect(recordAgentActivity({
        db: capsuleDb(),
        capsuleId: "WC-SESS",
        activity: { type: "chatter" as never, body: "nope" },
        actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
      })).rejects.toThrow(/activity type/i);
      expect(db.workCapsule.findUnique).not.toHaveBeenCalled();
    });

    it("throws when the capsule does not exist", async () => {
      db.workCapsule.findUnique.mockResolvedValueOnce(null);
      await expect(recordAgentActivity({
        db: capsuleDb(),
        capsuleId: "WC-MISSING",
        activity: { type: "thought", body: "hmm" },
        actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
      })).rejects.toThrow(/not found/i);
    });
  });
});
