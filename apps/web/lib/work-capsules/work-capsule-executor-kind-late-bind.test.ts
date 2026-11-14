import { describe, expect, it } from "vitest";
import { planLiveCapsuleBinding } from "./work-capsule-branch-identity";

// BI-E1020AAE: WC-AA3A9FFF on production, 2026-11-13. adopt_worktree created the
// room without an executor kind; every later claim (provider codex) was refused
// CAPSULE_IDENTITY_MISMATCH because nothing ever filled the kind in.
const input = { title: "t", objective: "o", repositoryFullName: "o/r", headBranch: "fix/x", worktreePath: "/w",
  executorKind: "codex-desktop" as const, executorRef: "t3-thread" };

describe("a claim on an existing room fills a missing executor kind (BI-E1020AAE)", () => {
  it("fills the kind on the room's own session, guarded against a concurrent writer", () => {
    const plan = planLiveCapsuleBinding({ backlogItemId: "BI-1", epicId: null, executorRef: "t3-thread", executorKind: null }, input);
    expect(plan).toMatchObject({ changed: true, where: { executorKind: null }, data: { executorKind: "codex-desktop" },
      evidence: { executorKind: "codex-desktop", executorKindLateBind: true } });
  });
  it("fills both session and kind on a room that has neither", () => {
    const plan = planLiveCapsuleBinding({ backlogItemId: null, epicId: null, executorRef: null, executorKind: null }, input);
    expect(plan.data).toMatchObject({ executorRef: "t3-thread", executorKind: "codex-desktop" });
    expect(plan.where).toEqual({ executorRef: null, executorKind: null });
  });
  it("never rewrites a recorded kind, nor fills one for another session's room", () => {
    expect(planLiveCapsuleBinding({ backlogItemId: "BI-1", epicId: null, executorRef: "t3-thread", executorKind: "claude-desktop" }, input).changed).toBe(false);
    expect(planLiveCapsuleBinding({ backlogItemId: "BI-1", epicId: null, executorRef: "someone-else", executorKind: null }, input).changed).toBe(false);
  });
});
