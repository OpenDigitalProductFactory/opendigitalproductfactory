// BI-36FC2981 — adopting a branch for backlog work gives the room its owner, and
// a room adopted without both SHAs is told, at adoption, how to repair it.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("./capsule-workitem-anchor.server", () => ({ ensureCapsuleWorkItemAnchorNonFatal: vi.fn() }));

import { adoptWorktree } from "./adopt-worktree-handler";
import type { CapsuleDb } from "./work-capsule-store-types";

function database() {
  const db = {
    workroom: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "row-1", capsuleId: "WC-NEW00001", ...data })),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
    },
    workroomActivity: { create: vi.fn(async () => ({ id: "act" })) },
    workroomParticipant: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

const params = {
  title: "Work on BI-X",
  objective: "Deliver BI-X",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  headBranch: "fix/x",
  worktreePath: "D:/DPF-worktrees/x",
  backlogItemId: "BI-X",
};

const oauthActor = async () => ({ userId: "user-1", agentId: "AGT-EXT-CLAUDE", principalId: "HUMAN", agentPrincipalId: "ASSISTANT" });
const bindingReader = { backlogItem: { findFirst: vi.fn(async () => ({ itemId: "BI-X" })) } };

describe("adopt_worktree for backlog work", () => {
  it("makes the person the owner, admits the assistant, and asks for the missing SHAs", async () => {
    const db = database();
    const result = await adoptWorktree({
      db: db as unknown as CapsuleDb, userId: "user-1", context: undefined, bindingReader, resolveActor: oauthActor, params,
    });
    expect(result.success).toBe(true);
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: "HUMAN", roles: ["coordinator"] }) });
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ principalId: "ASSISTANT", roles: ["contributor"] }) });
    expect(result.message).toContain("now owns the room");
    expect(result.data).toMatchObject({
      identityRepair: {
        toolName: "adopt_worktree",
        missingFields: ["baseSha", "headSha"],
        packet: expect.objectContaining({ title: "Work on BI-X", objective: "Deliver BI-X", backlogItemId: "BI-X" }),
      },
    });
  });

  it("asks for nothing when both SHAs are supplied", async () => {
    const db = database();
    const result = await adoptWorktree({
      db: db as unknown as CapsuleDb, userId: "user-1", context: undefined, bindingReader, resolveActor: oauthActor,
      params: { ...params, baseSha: "3".repeat(40), headSha: "1".repeat(40) },
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("identityRepair");
  });

  it("leaves an unbound adoption unowned, as before", async () => {
    const db = database();
    const { backlogItemId: _omit, ...unbound } = params;
    const result = await adoptWorktree({
      db: db as unknown as CapsuleDb, userId: "user-1", context: undefined, bindingReader, resolveActor: oauthActor, params: unbound,
    });
    expect(result.success).toBe(true);
    expect(db.workroomParticipant.create).not.toHaveBeenCalled();
  });
});
