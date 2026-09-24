// BI-36FC2981 — a governed claim writes the room's owner and source identity in
// its own transaction, and its readback refuses a room without exactly one owner
// or with a different head than the claim asked for.
import { describe, expect, it, vi } from "vitest";

import { claimGovernedBacklogWorkspace } from "./governed-work-claim";
import type { CapsuleDb } from "./work-capsule-store-types";

const BASE = "3333333333333333333333333333333333333333";
const HEAD = "1111111111111111111111111111111111111111";
const oauthActor = { userId: "user-1", agentId: "AGT-EXT-CODEX", principalId: "HUMAN", agentPrincipalId: "ASSISTANT" };
const input = {
  backlogItemId: "BI-ENTRY",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "fix/entry",
  worktreePath: "D:\\DPF-worktrees\\entry",
  baseBranch: "main",
  baseSha: BASE,
  headSha: HEAD,
  executorKind: "codex-desktop" as const,
  executorRef: "session-1",
};

function database(opts: { participantRows: Array<{ roles: string[] }>; headSha?: string } ) {
  const created: unknown[] = [];
  const db = {
    backlogItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: "row-bi", itemId: "BI-ENTRY", type: "product", source: "user-request", workType: "bug",
        scopeKind: "platform", archetypeCategories: [], archetypeIds: [], activeBuild: null,
      }),
      update: vi.fn(),
    },
    backlogItemActivity: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "decision-row" }),
    },
    workroom: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({
        id: "row-wc", capsuleId: "WC-ENTRY", backlogItemId: "BI-ENTRY", status: "ready", archivedAt: null,
        repositoryFullName: input.repositoryFullName, headBranch: input.headBranch, worktreePath: input.worktreePath,
        executorKind: input.executorKind, executorRef: input.executorRef,
        baseSha: BASE, headSha: opts.headSha ?? HEAD,
        leaseHolderPrincipalId: "HUMAN", leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    workroomActivity: {
      create: vi.fn(async (args: unknown) => { created.push(args); return { id: "act" }; }),
      findFirst: vi.fn().mockResolvedValue({
        payload: { schemaVersion: 1, intent: "design", policyVersion: "initiative-readiness.v1", subject: { kind: "backlog-item", id: "BI-ENTRY" } },
      }),
    },
    workroomParticipant: {
      // First read: nobody in the room. Second read (the readback count): what the test says exists.
      findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValue(opts.participantRows),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    agentToolGrant: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { db: db as unknown as CapsuleDb, raw: db, created };
}

const claimWorkspace = vi.fn().mockResolvedValue({
  capsuleId: "WC-ENTRY", backlogItemId: "BI-ENTRY", headBranch: input.headBranch,
  worktreePath: input.worktreePath, claimed: true, conflict: null,
});
const declareIntent = vi.fn().mockResolvedValue({ id: "intent-row" });

describe("a governed claim is born owned", () => {
  it("writes the human as owner and the assistant as contributor, then reads both back", async () => {
    const { db, raw } = database({ participantRows: [{ roles: ["coordinator"] }, { roles: ["contributor"] }] });
    const result = await claimGovernedBacklogWorkspace({
      db, input, actor: oauthActor, workIntent: "design", now: new Date("2026-09-24T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent },
    });
    expect(result.ok).toBe(true);
    expect(raw.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: "HUMAN", roles: ["coordinator"] }) });
    expect(raw.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: "ASSISTANT", roles: ["contributor"] }) });
    expect(claimWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ baseSha: BASE, headSha: HEAD }),
    }));
    expect(raw.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "row-wc", kind: "coworker-joined", recordedById: "user-1", recordedByAgentId: "AGT-EXT-CODEX",
    }) });
  });

  it("refuses the claim when the room does not end with exactly one owner", async () => {
    const { db } = database({ participantRows: [] });
    const result = await claimGovernedBacklogWorkspace({
      db, input, actor: oauthActor, workIntent: "design", now: new Date("2026-09-24T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("needs exactly one");
  });

  it("refuses the claim when the recorded head differs from the one it asked for", async () => {
    const { db } = database({ participantRows: [{ roles: ["coordinator"] }], headSha: "2".repeat(40) });
    const result = await claimGovernedBacklogWorkspace({
      db, input, actor: oauthActor, workIntent: "design", now: new Date("2026-09-24T00:00:00.000Z"),
      dependencies: { claimWorkspace, declareIntent },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("The recorded head commit");
  });
});
