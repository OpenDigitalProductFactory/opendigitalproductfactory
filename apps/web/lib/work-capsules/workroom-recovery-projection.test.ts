import { describe, expect, it } from "vitest";

import { projectWorkroomRecovery } from "./workroom-recovery-projection";

const identity = {
  repositoryFullName: "owner/repo",
  headBranch: "fix/recovery",
  worktreePath: "D:/worktree",
  baseSha: "0".repeat(40),
  headSha: "1".repeat(40),
};

describe("projectWorkroomRecovery", () => {
  it.each(["completed", "failed", "canceled", "rejected", "archived"])(
    "projects canonical terminal TaskRun status %s as terminal",
    (status) => {
      expect(projectWorkroomRecovery({
        ...identity,
        taskRun: { taskRunId: `TR-${status}`, status },
      })).toMatchObject({
        state: "terminal",
        reviewerExecution: { status, pending: false },
      });
    },
  );

  it.each([
    ["submitted", "queued", true], ["working", "working", true], ["active", "working", true],
    ["input-required", "waiting", true], ["auth-required", "waiting", true],
    ["stalled", "waiting", true], ["quiescing", "waiting", true],
    ["paused-for-upgrade", "waiting", true], ["paused-for-upgrade-forced", "waiting", true],
    ["future-status", "unknown", null],
  ])(
    "projects recorded status %s as %s without claiming queued execution",
    (status, state, pending) => {
      expect(projectWorkroomRecovery({
        ...identity,
        taskRun: { taskRunId: `TR-${status}`, status: String(status) },
      })).toMatchObject({
        state,
        reviewerExecution: { status, pending },
      });
    },
  );
});

describe("identity repair packet (observed 2026-09-23: the packet could not be replayed)", () => {
  it("carries every field adopt_worktree requires, and names the missing SHAs", () => {
    const recovery = projectWorkroomRecovery({
      ...identity,
      baseSha: null,
      title: "Work on BI-X",
      objective: "Claim-at-start binding for BI-X",
      backlogItemId: "BI-X",
      baseBranch: "main",
    });
    expect(recovery.state).toBe("blocked");
    expect(recovery.prerequisite?.repair.packet).toMatchObject({
      title: "Work on BI-X",
      objective: "Claim-at-start binding for BI-X",
      backlogItemId: "BI-X",
      repositoryFullName: "owner/repo",
      headBranch: "fix/recovery",
      worktreePath: "D:/worktree",
      headSha: "1".repeat(40),
    });
    expect(recovery.prerequisite?.missingFields).toEqual(["baseSha"]);
    expect(recovery.prerequisite?.nextAction).toContain("baseSha");
  });
});
