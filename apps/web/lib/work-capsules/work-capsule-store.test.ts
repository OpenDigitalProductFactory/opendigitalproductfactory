import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adoptWorktreeCapsule,
  createWorkCapsule,
  heartbeatWorkCapsule,
  planCapsuleWorkspace,
  recordWorkCapsuleEvidence,
  type CapsuleDb,
} from "./work-capsule-store";

const db = {
  workCapsule: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  workCapsuleActivity: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};

function resetDbMocks() {
  db.workCapsule.create.mockReset();
  db.workCapsule.findFirst.mockReset();
  db.workCapsule.findUnique.mockReset();
  db.workCapsule.update.mockReset();
  db.workCapsuleActivity.create.mockReset();
  db.$transaction.mockReset();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
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
});
