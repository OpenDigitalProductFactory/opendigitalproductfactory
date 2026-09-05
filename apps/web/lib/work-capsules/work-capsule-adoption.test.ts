import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({
  revalidatePortalContext: vi.fn(),
}));

import {
  adoptWorktreeCapsule,
  CapsuleBranchOccupiedError,
  type CapsuleDb,
} from "./work-capsule-store";

const db = {
  workroom: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  workroomActivity: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};

function capsuleDb(): CapsuleDb {
  return db as unknown as CapsuleDb;
}

describe("work capsule branch adoption", () => {
  beforeEach(() => {
    db.workroom.create.mockReset();
    db.workroom.findFirst.mockReset();
    db.workroom.update.mockReset();
    db.workroomActivity.create.mockReset();
    db.$transaction.mockReset();
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  });

  it("persists backlogItemId + epicId on a fresh adoption", async () => {
    db.workroom.findFirst.mockResolvedValueOnce(null);
    db.workroom.create.mockResolvedValueOnce({ id: "row-1", capsuleId: "WC-BOUND01" });

    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Bound branch",
        objective: "Work an item.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/bound",
        worktreePath: "D:/DPF-bound",
        backlogItemId: "BI-7D20BFDF",
        epicId: "EP-XYZ",
        executorRef: "session-1",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-BOUND01");
    expect(db.workroom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        backlogItemId: "BI-7D20BFDF",
        epicId: "EP-XYZ",
        executorRef: "session-1",
      }),
    }));
  });

  it("late-binds an existing unbound capsule", async () => {
    db.workroom.findFirst.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-EXISTING",
      status: "ready",
      backlogItemId: null,
      epicId: null,
      executorRef: null,
    });
    db.workroom.update.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-EXISTING",
      backlogItemId: "BI-7D20BFDF",
    });

    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Reuse",
        objective: "Reuse existing branch.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/existing",
        worktreePath: "D:/DPF-existing",
        backlogItemId: "BI-7D20BFDF",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-EXISTING");
    expect(db.workroom.create).not.toHaveBeenCalled();
    expect(db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ backlogItemId: "BI-7D20BFDF" }),
    }));
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "adopted", payload: expect.objectContaining({ lateBind: true }) }),
    }));
  });

  it("reuses a live capsule already bound to the same backlog item", async () => {
    db.workroom.findFirst.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-EXISTING",
      status: "working",
      backlogItemId: "BI-7D20BFDF",
      executorRef: null,
      // Matches the input below, so this is genuine pure reuse: nothing about
      // the room's identity differs and nothing should be written. The row used
      // to omit worktreePath entirely, which no real row does once a location
      // has been recorded (BI-69BBC446).
      worktreePath: "D:/DPF-existing",
    });

    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Reuse",
        objective: "Reuse existing branch.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/existing",
        worktreePath: "D:/DPF-existing",
        backlogItemId: "BI-7D20BFDF",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(result.capsuleId).toBe("WC-EXISTING");
    expect(db.workroom.update).not.toHaveBeenCalled();
    expect(db.workroom.create).not.toHaveBeenCalled();
  });

  // The other half of BI-69BBC446: a room whose worktreePath is still null is
  // learning its location for the first time, not moving. Writing it is correct
  // — the same shape as the executorRef late-bind directly above.
  it("records a worktree path onto a bound capsule that has none yet", async () => {
    db.workroom.findFirst.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-NOPATH",
      status: "working",
      backlogItemId: "BI-7D20BFDF",
      executorRef: null,
      worktreePath: null,
    });
    db.workroom.update.mockResolvedValue({
      id: "row-1", capsuleId: "WC-NOPATH", worktreePath: "D:/DPF-learned",
    });

    await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Learn location",
        objective: "Record where this branch actually lives.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/existing",
        worktreePath: "D:/DPF-learned",
        backlogItemId: "BI-7D20BFDF",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ worktreePath: "D:/DPF-learned" }),
    }));
  });

  it("reactivates the same abandoned capsule when the BI and branch still match", async () => {
    db.workroom.findFirst.mockResolvedValueOnce({
      id: "row-abandoned",
      capsuleId: "WC-RESUME01",
      status: "abandoned",
      archivedAt: null,
      backlogItemId: "BI-RESUME",
      epicId: "EP-PROCESS-SPINE",
      executorKind: "codex-desktop",
      executorRef: "session-old",
      baseBranch: "main",
      headBranch: "fix/resume",
    });
    db.workroom.update.mockResolvedValueOnce({
      id: "row-abandoned",
      capsuleId: "WC-RESUME01",
      status: "ready",
      backlogItemId: "BI-RESUME",
      executorRef: "session-new",
    });

    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Resume BI-RESUME",
        objective: "Resume the preserved branch.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "fix/resume",
        worktreePath: "D:/DPF-worktrees/resume",
        backlogItemId: "BI-RESUME",
        executorRef: "session-new",
        executorKind: "codex-desktop",
        headSha: "abc123",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });

    expect(result).toMatchObject({ capsuleId: "WC-RESUME01", status: "ready" });
    expect(db.workroom.create).not.toHaveBeenCalled();
    expect(db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-RESUME01" },
      data: expect.objectContaining({
        status: "ready",
        executorRef: "session-new",
        leaseHolderPrincipalId: "principal-1",
        headSha: "abc123",
        worktreePath: "D:/DPF-worktrees/resume",
      }),
    }));
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "adopted",
        payload: expect.objectContaining({ resumed: true, previousStatus: "abandoned" }),
      }),
    }));
  });

  it("refuses to overwrite capsule history when the branch belongs to a different BI", async () => {
    db.workroom.findFirst.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-OTHERBI",
      status: "abandoned",
      backlogItemId: "BI-OTHER",
      executorRef: "session-other",
      headBranch: "fix/shared",
    });

    await expect(adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Mine",
        objective: "Different BI on same branch.",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "fix/shared",
        worktreePath: "D:/DPF-worktrees/shared",
        backlogItemId: "BI-MINE",
        executorRef: "session-mine",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    })).rejects.toBeInstanceOf(CapsuleBranchOccupiedError);

    expect(db.workroom.create).not.toHaveBeenCalled();
    expect(db.workroom.update).not.toHaveBeenCalled();
  });
});
