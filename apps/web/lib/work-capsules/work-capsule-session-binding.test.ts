import { describe, expect, it, vi } from "vitest";
import { adoptWorktreeCapsule, claimWorkCapsuleScope, createWorkCapsule, planCapsuleWorkspace, type CapsuleDb } from "./work-capsule-store";

vi.mock("./scope-epoch-enrollment.server", () => ({ assertScopeEpochEnrollmentReady: async () => ({ assertCurrent() {} }) }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

const actor = { userId: "author", agentId: "AGT-EXT-CODEX", principalId: "human-principal", agentPrincipalId: "assistant-principal" };

async function backlogBoundRoom() {
  let row: Record<string, unknown> | null = null;
  const db = {
    workroom: {
      findUnique: vi.fn(async () => row),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        row && typeof where.headBranch === "string" && where.headBranch === row.headBranch ? row : null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { id: "room-row", ...data };
        return row;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data };
        return row;
      }),
    },
    workroomActivity: { create: vi.fn(async () => ({})) },
  };
  const database = { ...db, $transaction: async <T>(fn: (tx: CapsuleDb) => Promise<T>) => fn(db as unknown as CapsuleDb) } as unknown as CapsuleDb;
  const created = await createWorkCapsule({ db: database, actor, input: {
    title: "Bind author session", objective: "Preserve the author and the session", source: "external-adoption",
    executorKind: "codex-desktop", backlogItemId: "BI-SESSION-TEST", idempotencyKey: "session-binding-test",
  } });
  const planned = await planCapsuleWorkspace({ db: database, actor, capsuleId: created.capsuleId, taxonomy: "fix", os: "linux" });
  const input = {
    title: created.title, objective: created.objective, repositoryFullName: planned.repositoryFullName!,
    headBranch: planned.headBranch!, worktreePath: planned.worktreePath!, backlogItemId: "BI-SESSION-TEST",
    executorKind: "codex-desktop" as const,
  };
  db.workroom.update.mockClear();
  return { db, database, created, input, current: () => row!, setSession: (session: string) => { row = { ...row, executorRef: session }; } };
}

describe("adoption of an already backlog-bound sessionless Workroom", () => {
  it("binds the session on the existing room before its author claims scope", async () => {
    const f = await backlogBoundRoom();
    const adopted = await adoptWorktreeCapsule({ db: f.database, actor, input: { ...f.input, executorRef: "session-a" } });
    expect(adopted.capsuleId).toBe(f.created.capsuleId);
    expect(adopted.executorRef).toBe("session-a");
    expect(f.db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ executorRef: null }), data: expect.objectContaining({ executorRef: "session-a" }),
    }));
    const claimed = await claimWorkCapsuleScope({ db: f.database, actor, capsuleId: adopted.capsuleId,
      claims: [{ kind: "path", value: "apps/web/lib/session-test.ts", intent: "edit" }],
    });
    expect(claimed.executorRef).toBe("session-a");
    expect(claimed.backlogItemId).toBe("BI-SESSION-TEST");
    expect(f.db.workroom.create).toHaveBeenCalledTimes(1);
  });

  it("leaves a missing session unchanged when adoption omits it", async () => {
    const f = await backlogBoundRoom();
    await adoptWorktreeCapsule({ db: f.database, actor, input: f.input });
    expect(f.current().executorRef).toBeNull();
    expect(f.db.workroom.update).not.toHaveBeenCalled();
  });

  it("does not write again for the same session", async () => {
    const f = await backlogBoundRoom();
    f.setSession("session-a");
    await adoptWorktreeCapsule({ db: f.database, actor, input: { ...f.input, executorRef: "session-a" } });
    expect(f.db.workroom.update).not.toHaveBeenCalled();
  });

  it("refuses to replace another recorded session even for the same human", async () => {
    const f = await backlogBoundRoom();
    f.setSession("session-b");
    await expect(adoptWorktreeCapsule({ db: f.database, actor, input: { ...f.input, executorRef: "session-a" } })).rejects.toThrow("already bound");
    expect(f.current().executorRef).toBe("session-b");
    expect(f.db.workroom.update).not.toHaveBeenCalled();
  });
});
