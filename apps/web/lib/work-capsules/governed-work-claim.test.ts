import { describe, expect, it, vi } from "vitest";

import { claimGovernedBacklogWorkspace } from "./governed-work-claim";
import type { CapsuleDb } from "./work-capsule-store-types";

const actor = { userId: "user-1", agentId: "AGT-1", principalId: "PRN-1" };
const input = {
  backlogItemId: "BI-ENTRY",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "feat/entry",
  worktreePath: "D:\\DPF-worktrees\\entry",
  baseBranch: "main",
  executorKind: "codex-desktop" as const,
  executorRef: "session-1",
};

function database(activities: unknown[] = []) {
  const db = {
    backlogItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: "row-bi",
        itemId: "BI-ENTRY",
        type: "portfolio",
        source: "user-request",
        workType: "feature",
        scopeKind: "platform",
        archetypeCategories: [],
        archetypeIds: [],
        activeBuild: null,
      }),
      update: vi.fn(),
    },
    backlogItemActivity: {
      findMany: vi.fn().mockResolvedValue(activities),
      create: vi.fn().mockResolvedValue({ id: "decision-row" }),
    },
    workroom: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({
        id: "row-wc",
        capsuleId: "WC-ENTRY",
        backlogItemId: "BI-ENTRY",
        status: "ready",
        archivedAt: null,
        repositoryFullName: input.repositoryFullName,
        headBranch: input.headBranch,
        worktreePath: input.worktreePath,
        executorKind: input.executorKind,
        executorRef: input.executorRef,
        leaseHolderPrincipalId: actor.principalId,
        leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      }),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    workroomActivity: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({
        payload: {
          schemaVersion: 1,
          intent: "design",
          policyVersion: "initiative-readiness.v1",
          subject: { kind: "backlog-item", id: "BI-ENTRY" },
        },
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db as unknown as CapsuleDb;
}

describe("claimGovernedBacklogWorkspace", () => {
  it("records a denial without mutating workspace state for a legacy implementation claim", async () => {
    const db = database();
    const claimWorkspace = vi.fn();

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: null,
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace },
    });

    expect(result).toMatchObject({
      ok: false,
      data: { code: "initiative_not_ready", workIntent: "implementation" },
    });
    expect(claimWorkspace).not.toHaveBeenCalled();
    expect(db.backlogItemActivity?.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "initiative_readiness_decision" }),
    }));
  });

  it("atomically declares design intent and returns exact readback for governed design work", async () => {
    const db = database();
    const claimWorkspace = vi.fn().mockResolvedValue({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      claimed: true,
      conflict: null,
    });
    const declareIntent = vi.fn().mockResolvedValue({ id: "intent-row" });

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: "design",
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent },
    });

    expect(result).toMatchObject({
      ok: true,
      data: { workIntent: "design", readiness: { verdict: "allowed" } },
    });
    expect(declareIntent).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-ENTRY",
      intent: "design",
      subject: { kind: "backlog-item", id: "BI-ENTRY" },
    }));
    expect(result.ok && result.data.readback).toMatchObject({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      executorRef: "session-1",
      workIntent: "design",
    });
  });

  it("rolls back an allowed claim when exact readback does not match the requested session", async () => {
    const db = database();
    const claimWorkspace = vi.fn().mockResolvedValue({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      claimed: true,
      conflict: null,
    });
    const declareIntent = vi.fn().mockResolvedValue({ id: "intent-row" });
    (db.workroom.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      capsuleId: "WC-ENTRY",
      backlogItemId: "BI-ENTRY",
      status: "ready",
      archivedAt: null,
      repositoryFullName: input.repositoryFullName,
      headBranch: input.headBranch,
      worktreePath: input.worktreePath,
      executorKind: input.executorKind,
      executorRef: "foreign-session",
      leaseHolderPrincipalId: actor.principalId,
      leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const result = await claimGovernedBacklogWorkspace({
      db,
      input,
      actor,
      workIntent: "design",
      now: new Date("2026-08-22T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent },
    });

    expect(result).toMatchObject({ ok: false, data: { code: "capsule_identity_mismatch" } });
    expect(db.$transaction).toHaveBeenCalled();
  });
});
