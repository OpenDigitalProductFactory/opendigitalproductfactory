import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({
  revalidatePortalContext: vi.fn(),
}));

import {
  adoptWorktreeCapsule,
  createWorkCapsule,
  planCapsuleWorkspace,
  type CapsuleDb,
} from "./work-capsule-store";

const db = {
  workroom: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  workroomActivity: { create: vi.fn() },
  backlogItem: { findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};

function capsuleDb(): CapsuleDb {
  return db as unknown as CapsuleDb;
}

beforeEach(() => {
  for (const model of [db.workroom, db.workroomActivity, db.backlogItem]) {
    for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  db.$transaction.mockReset();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});

// BI-F83CF689: create_workroom / plan_workroom_worktree left
// repositoryFullName null, so the (repo, branch) identity key could not match
// and claim_backlog_item_for_work forked a SECOND live capsule on a branch
// that already had one. Both calls reported success.
describe("branch identity is keyed on (repository, branch) — BI-F83CF689", () => {
  it("stamps the platform repository when create_workroom does not name one", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(null);
    db.workroom.create.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-REPO001" });

    await createWorkCapsule({
      db: capsuleDb(),
      input: {
        title: "Plan coverage",
        objective: "Make the receipt reachable.",
        source: "manual",
        idempotencyKey: "manual:repo-default",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(db.workroom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      }),
    }));
  });

  it("backfills the repository when planning a worktree for a repo-less capsule", async () => {
    db.workroom.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-REPO002",
      title: "Plan coverage",
      status: "draft",
      headBranch: null,
      worktreePath: null,
      baseBranch: null,
      repositoryFullName: null,
    });
    db.workroom.findFirst.mockResolvedValue(null);
    db.workroom.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "row-1",
      capsuleId: "WC-REPO002",
      ...data,
    }));

    const planned = await planCapsuleWorkspace({
      db: capsuleDb(),
      capsuleId: "WC-REPO002",
      taxonomy: "fix",
      os: "linux",
      home: "/home/dev",
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(planned.repositoryFullName).toBe("OpenDigitalProductFactory/opendigitalproductfactory");
  });

  it("late-binds a repo-less capsule on the same branch instead of forking a second one", async () => {
    // Row written before the default existed: same branch, no repository.
    db.workroom.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-ORPHAN1",
        status: "ready",
        backlogItemId: null,
        executorRef: null,
        headBranch: "feat/identity",
        worktreePath: "/wt/identity",
        repositoryFullName: null,
      });
    db.workroom.update.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-ORPHAN1",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    });

    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Adopt",
        objective: "Bind the branch.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/identity",
        worktreePath: "/wt/identity",
        backlogItemId: "BI-F83CF689",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-ORPHAN1");
    expect(db.workroom.create).not.toHaveBeenCalled();
    expect(db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        backlogItemId: "BI-F83CF689",
      }),
    }));
  });

  it("refuses loudly when the repo-less capsule on the branch belongs to another item", async () => {
    db.workroom.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "row-1",
        capsuleId: "WC-ORPHAN2",
        status: "working",
        backlogItemId: "BI-OTHER",
        executorRef: "session-other",
        headBranch: "feat/identity",
        worktreePath: "/wt/identity",
        repositoryFullName: null,
      });

    await expect(adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Adopt",
        objective: "Bind the branch.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/identity",
        worktreePath: "/wt/identity",
        backlogItemId: "BI-F83CF689",
      },
      actor: { userId: "user-1", agentId: null, principalId: "principal-1" },
    })).rejects.toThrow(/already bound to Work Capsule WC-ORPHAN2/);
    expect(db.workroom.create).not.toHaveBeenCalled();
  });
});
