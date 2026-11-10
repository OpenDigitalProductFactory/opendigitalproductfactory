import { vi } from "vitest";
import type { CapsuleDb } from "./work-capsule-store-types";

export const actor = { userId: "user-1", agentId: "AGT-1", principalId: "PRN-1" };
export const input = {
  backlogItemId: "BI-ENTRY",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "feat/entry",
  worktreePath: "D:\\DPF-worktrees\\entry",
  baseBranch: "main",
  executorKind: "codex-desktop" as const,
  executorRef: "session-1",
};

export function database(activities: unknown[] = []) {
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
      // Honour the `where` clause rather than answering unconditionally: the room
      // on this branch carries NO item binding, which is the state a room is
      // actually in before any claim has succeeded for its item. A mock that
      // answers regardless of the query cannot tell the old lookup from the new
      // one, so it would pass either way and prove nothing (BI-512214EA).
      findFirst: vi.fn().mockImplementation((args?: { where?: { backlogItemId?: string } }) =>
        Promise.resolve(args?.where?.backlogItemId ? null : {
          capsuleId: "WC-ENTRY",
          repositoryFullName: input.repositoryFullName,
          headBranch: input.headBranch,
          headSha: "1111111111111111111111111111111111111111",
          baseSha: "3333333333333333333333333333333333333333",
          archivedAt: null,
        })),
      // Recovery matches rooms on branch identity (BI-512214EA), so the default
      // room here carries NO backlogItemId — the state a room is actually in
      // before a claim has ever succeeded for its item.
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
      findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-ENTRY",
        repositoryFullName: input.repositoryFullName,
        headBranch: input.headBranch,
        headSha: "1111111111111111111111111111111111111111",
        baseSha: "3333333333333333333333333333333333333333",
        backlogItemId: null,
      }]),
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
    agentToolGrant: {
      findMany: vi.fn().mockResolvedValue([
        {
          grantKey: "initiative_design_review",
          agent: {
            agentId: "AGT-INDEPENDENT-REVIEWER",
            displayName: "Independent Design Reviewer",
            status: "active",
            archived: false,
            lifecycleStage: "production",
          },
        },
        {
          grantKey: "file_read",
          agent: {
            agentId: "AGT-INDEPENDENT-REVIEWER",
            displayName: "Independent Design Reviewer",
            status: "active",
            archived: false,
            lifecycleStage: "production",
          },
        },
      ]),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db as unknown as CapsuleDb;
}
