import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({
  revalidatePortalContext: vi.fn(),
}));
vi.mock("./capsule-workitem-anchor.server", () => ({ ensureCapsuleWorkItemAnchorNonFatal: vi.fn() }));
import { adoptWorktree } from "./adopt-worktree-handler";

import {
  adoptWorktreeCapsule,
  createWorkCapsule,
  claimWorkCapsuleScope,
  releaseWorkCapsuleScope,
  CapsuleBranchOccupiedError,
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
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};

function capsuleDb(): CapsuleDb {
  return db as unknown as CapsuleDb;
}

describe("work capsule branch adoption", () => {
  beforeEach(() => {
    db.workroom.create.mockReset();
    db.workroom.findFirst.mockReset();
    db.workroom.findUnique.mockReset();
    db.workroom.findMany.mockReset().mockResolvedValue([]);
    db.workroom.update.mockReset();
    db.workroomActivity.create.mockReset();
    db.$transaction.mockReset();
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  });

  it("carries the MCP execution shape through adoption to persisted readback", async () => {
    db.workroom.findFirst.mockResolvedValueOnce(null);
    db.workroom.create.mockImplementationOnce(async ({ data }) => ({ id: "row-shape", ...data }));
    const result = await adoptWorktree({
      db: capsuleDb(), userId: "user-1", context: undefined,
      bindingReader: { backlogItem: { findFirst: vi.fn() } },
      resolveActor: async () => ({ userId: "user-1", agentId: "codex", principalId: "principal-1" }),
      params: {
        title: "Reviewer recovery", objective: "Recover review independently of the client",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/reviewer-recovery", worktreePath: "D:/DPF-reviewer",
        workShape: "delivery-large@1.0.0",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ capsule: { scopeClaims: expect.arrayContaining([
      expect.objectContaining({ workShape: "delivery-large@1.0.0" }),
    ]) } });
  });

  it.each(["missing-shape@1.0.0", "delivery-large@99.0.0"])("refuses unavailable execution definition %s before writing", async (workShape) => {
    db.workroom.findFirst.mockResolvedValue(null);
    db.workroom.create.mockImplementation(async ({ data }) => ({ id: "invalid-shape-row", ...data }));
    const result = await adoptWorktree({
      db: capsuleDb(), userId: "user-1", context: undefined,
      bindingReader: { backlogItem: { findFirst: vi.fn() } },
      resolveActor: async () => ({ userId: "user-1", agentId: "codex", principalId: "principal-1" }),
      params: { title: "Reviewer", objective: "Recover", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", headBranch: "feat/reviewer", worktreePath: "D:/DPF-reviewer", workShape },
    });
    expect(result).toMatchObject({ success: false, error: "invalid_scope" });
    expect(db.workroom.create).not.toHaveBeenCalled();
    expect(db.workroom.update).not.toHaveBeenCalled();
  });

  it("persists the versioned execution shape on fresh adoption and readback", async () => {
    db.workroom.findFirst.mockResolvedValueOnce(null);
    db.workroom.create.mockImplementationOnce(async ({ data }) => ({ id: "row-shape", ...data }));
    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Reviewer recovery", objective: "Recover review independently of the client",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/reviewer-recovery", worktreePath: "D:/DPF-reviewer",
        scope: { workShape: "delivery-large@1.0.0" },
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });
    expect(result.scopeClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({ workShape: "delivery-large@1.0.0" }),
    ]));
  });

  it.each(["ready", "abandoned"])("updates a %s adopted shape while preserving unrelated scope claims", async (status) => {
    const unrelated = [
      { kind: "path", value: "apps/web/lib/example.ts", intent: "edit", recordedAt: "2026-09-01", recordedByPrincipalId: "principal-1" },
      { workroomShape: "solo", recordedAt: "2026-09-01" },
      { extension: { owner: "another-subsystem" } },
    ];
    const existing = {
      id: "row-shape", capsuleId: "WC-SHAPE", status, backlogItemId: null,
      executorRef: null, worktreePath: "D:/DPF-reviewer",
      scopeClaims: [...unrelated, { workShape: "delivery-small@1.0.0", recordedAt: "2026-09-01" }],
    };
    db.workroom.findFirst.mockResolvedValue(existing);
    db.workroom.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    const result = await adoptWorktreeCapsule({
      db: capsuleDb(),
      input: {
        title: "Reviewer recovery", objective: "Recover review independently of the client",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: "feat/reviewer-recovery", worktreePath: "D:/DPF-reviewer",
        scope: { workShape: "delivery-large@1.0.0" },
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" },
    });
    expect(result.scopeClaims).toEqual([
      ...unrelated, expect.objectContaining({ workShape: "delivery-large@1.0.0" }),
    ]);
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      payload: expect.objectContaining({ scopeChanges: { workShape: { before: "delivery-small@1.0.0", after: "delivery-large@1.0.0" } } }),
    }) }));
  });

  it.each(["claim", "release"])("preserves the execution shape and foreign claims during scope %s", async (operation) => {
    const preserved = [{ workShape: "delivery-large@1.0.0", recordedAt: "2026-09-01" }, { extension: "foreign" }];
    const path = { kind: "module" as const, value: "reviewer", intent: "edit" as const, recordedAt: "2026-09-01", recordedByPrincipalId: "principal-1" };
    const existing = { id: "row-shape", capsuleId: "WC-SHAPE", status: "ready", scopeClaims: [...preserved, path] };
    db.workroom.findUnique.mockResolvedValue(existing);
    db.workroom.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    const args = { db: capsuleDb(), capsuleId: "WC-SHAPE", claims: [path], actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" } };
    const result = await (operation === "claim" ? claimWorkCapsuleScope(args) : releaseWorkCapsuleScope(args));
    expect(result.scopeClaims).toEqual(expect.arrayContaining(preserved));
    expect(result.scopeClaims).toHaveLength(operation === "claim" ? 3 : 2);
  });

  it.each(["adopt", "claim", "release"])("refuses a concurrent scope change during %s instead of overwriting it", async (operation) => {
    const original = [{ workShape: "delivery-small@1.0.0", recordedAt: "original" }];
    const concurrent = [...original, { extension: "written-concurrently" }];
    let stored = concurrent;
    const existing = { id: "row-shape", capsuleId: "WC-SHAPE", status: "ready", scopeClaims: original, worktreePath: "D:/DPF-reviewer" };
    db.workroom.findFirst.mockResolvedValue(existing);
    db.workroom.findUnique.mockResolvedValue(existing);
    db.workroom.update.mockImplementation(async ({ where, data }) => {
      if (where.scopeClaims && JSON.stringify(where.scopeClaims.equals) !== JSON.stringify(stored)) throw new Error("Concurrent scope change; read and retry");
      stored = data.scopeClaims;
      return { ...existing, ...data };
    });
    const actor = { userId: "user-1", agentId: "codex", principalId: "principal-1" };
    const promise = operation === "adopt" ? adoptWorktreeCapsule({ db: capsuleDb(), actor, input: {
      title: "Reviewer recovery", objective: "Recover review", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "feat/reviewer-recovery", worktreePath: "D:/DPF-reviewer", scope: { workShape: "delivery-large@1.0.0" },
    } }) : (operation === "claim" ? claimWorkCapsuleScope : releaseWorkCapsuleScope)({
      db: capsuleDb(), actor, capsuleId: "WC-SHAPE", claims: [{ kind: "module", value: "reviewer", intent: "edit" }],
    });
    await expect(promise).rejects.toThrow("Concurrent scope change");
    expect(stored).toEqual(concurrent);
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it.each(["delivery-large@1.0.0", "delivery-small@1.0.0"])("acknowledges duplicate adoption only when the winning shape matches (%s)", async (workShape) => {
    const winner = { id: "row-shape", capsuleId: "WC-SHAPE", status: "ready", scopeClaims: [{ workShape }], worktreePath: "D:/DPF-reviewer" };
    db.workroom.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    db.workroom.create.mockRejectedValueOnce({ code: "P2002" });
    const promise = adoptWorktreeCapsule({ db: capsuleDb(), actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" }, input: {
      title: "Reviewer recovery", objective: "Recover review", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "feat/reviewer-recovery", worktreePath: "D:/DPF-reviewer", scope: { workShape: "delivery-large@1.0.0" },
    } });
    if (workShape === "delivery-large@1.0.0") await expect(promise).resolves.toEqual(winner);
    else await expect(promise).rejects.toThrow(/scope.*retry/i);
    expect(db.workroom.update).not.toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("does not let an omitted session replace another executor's shape", async () => {
    db.workroom.findFirst.mockResolvedValue({ id: "row-other", capsuleId: "WC-OTHER", status: "ready", executorRef: "other-session", scopeClaims: [{ workShape: "delivery-small@1.0.0" }] });
    await expect(adoptWorktreeCapsule({ db: capsuleDb(), actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" }, input: {
      title: "Reviewer recovery", objective: "Recover review", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "feat/reviewer-recovery", worktreePath: "D:/DPF-reviewer", scope: { workShape: "delivery-large@1.0.0" },
    } })).rejects.toBeInstanceOf(CapsuleBranchOccupiedError);
    expect(db.workroom.update).not.toHaveBeenCalled();
  });

  it("refuses to acknowledge a different shape for an existing creation identity", async () => {
    db.workroom.findUnique.mockResolvedValue({ id: "row-shape", capsuleId: "WC-SHAPE", scopeClaims: [{ workShape: "delivery-small@1.0.0" }] });
    await expect(createWorkCapsule({ db: capsuleDb(), actor: { userId: "user-1", agentId: "codex", principalId: "principal-1" }, input: {
      title: "Reviewer", objective: "Recover", source: "manual", idempotencyKey: "reviewer-create", scope: { workShape: "delivery-large@1.0.0" },
    } })).rejects.toThrow(/scope/i);
    expect(db.workroom.create).not.toHaveBeenCalled();
    expect(db.workroom.update).not.toHaveBeenCalled();
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
