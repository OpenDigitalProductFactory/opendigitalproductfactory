import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn(), revalidatePortalContextForCapsule: vi.fn() }));
import { isRoomsOwnExecutor, queueWorkroomPullRequest, type QueuePrDeps } from "./queue-workroom-pr";
import type { WorkCapsuleActor } from "./work-capsule-store-types";

// BI-53BED66C: PR #7011, 2026-11-12. The T3-driven Codex session gated the PR,
// then `gh pr merge --squash --auto` was refused by the owner's Codex rules
// (prompt under approval policy "never"). Nothing else could queue it.
const HEAD = "c".repeat(40);
const codex: WorkCapsuleActor = { userId: "owner", principalId: "human", agentId: "AGT-EXT-CODEX", agentPrincipalId: "codex" };
function fixture() {
  const room = { id: "row-1", capsuleId: "WC-1920C35F", headSha: HEAD, pullRequestNumber: 7011 as number | null, repositoryFullName: "o/r",
    executorKind: "codex-desktop", leaseHolderPrincipalId: "human", createdByPrincipalId: "human", requestedByPrincipalId: "human",
    archivedAt: null as Date | null, status: "ready" };
  const pr = { nodeId: "PR_node", state: "OPEN", merged: false, headSha: HEAD, autoMergeEnabled: false, mergeQueueEntry: false };
  const activities: unknown[] = [];
  const deps = {
    db: {
      workroom: { findUnique: vi.fn(async (): Promise<typeof room> => ({ ...room })) },
      workroomActivity: { create: vi.fn(async ({ data }: { data: unknown }) => { activities.push(data); return { id: "a1", ...(data as object) }; }) },
      externalEvidenceRecord: { findMany: vi.fn(async () => [{ id: "gate-1" }]) },
    },
    actor: codex,
    resolveGateEvidence: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))),
    observePr: vi.fn(async () => ({ ...pr })),
    enableAutoMerge: vi.fn(async () => undefined),
  };
  return { room, pr, deps, activities };
}
const run = (f: ReturnType<typeof fixture>) => queueWorkroomPullRequest({ capsuleId: "WC-1920C35F" }, f.deps as unknown as QueuePrDeps);

describe("queue_workroom_pull_request (BI-53BED66C)", () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });

  it("queues the room's own gated PR, guarded by the room head, and records it", async () => {
    expect(await run(f)).toMatchObject({ success: true, data: { prNumber: 7011, headSha: HEAD, gateEvidenceId: "gate-1", alreadyQueued: false } });
    expect(f.deps.enableAutoMerge).toHaveBeenCalledWith({ nodeId: "PR_node", expectedHeadOid: HEAD });
    expect(f.activities).toHaveLength(1);
  });

  it("does nothing more when the PR is already queued", async () => {
    f.deps.observePr.mockResolvedValue({ ...f.pr, autoMergeEnabled: true });
    expect(await run(f)).toMatchObject({ success: true, data: { alreadyQueued: true } });
    expect(f.deps.enableAutoMerge).not.toHaveBeenCalled();
  });

  it.each([
    ["the PR head moved off the room head", (x: ReturnType<typeof fixture>) => x.deps.observePr.mockResolvedValue({ ...x.pr, headSha: "d".repeat(40) }), "pull_request_head_differs"],
    ["no passing gate is bound at the head", (x: ReturnType<typeof fixture>) => x.deps.resolveGateEvidence.mockResolvedValue([]), "gate_evidence_required"],
    ["the PR is closed", (x: ReturnType<typeof fixture>) => x.deps.observePr.mockResolvedValue({ ...x.pr, state: "CLOSED" }), "pull_request_not_open"],
    ["the room has no PR", (x: ReturnType<typeof fixture>) => x.deps.db.workroom.findUnique.mockResolvedValue({ ...x.room, pullRequestNumber: null }), "no_pull_request"],
    ["the caller is another surface", (x: ReturnType<typeof fixture>) => { x.deps.actor = { ...codex, agentId: "AGT-EXT-CLAUDE" }; }, "not_rooms_executor"],
    ["the caller acts for another person", (x: ReturnType<typeof fixture>) => { x.deps.actor = { ...codex, principalId: "someone" }; }, "not_rooms_executor"],
  ] as const)("refuses, queueing nothing, when %s", async (_, alter, error) => {
    alter(f);
    expect(await run(f)).toMatchObject({ success: false, error });
    expect(f.deps.enableAutoMerge).not.toHaveBeenCalled();
  });

  it("recognises the room's own executor only for the owner and the room's surface", () => {
    expect(isRoomsOwnExecutor(f.room, codex)).toBe(true);
    expect(isRoomsOwnExecutor({ ...f.room, executorKind: null }, codex)).toBe(false);
    expect(isRoomsOwnExecutor(f.room, { ...codex, agentId: undefined } as unknown as WorkCapsuleActor)).toBe(false);
  });
});
