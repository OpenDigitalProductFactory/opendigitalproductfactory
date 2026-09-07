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

  it.each(["submitted", "working", "input-required", "auth-required"])(
    "keeps nonterminal TaskRun status %s queued",
    (status) => {
      expect(projectWorkroomRecovery({
        ...identity,
        taskRun: { taskRunId: `TR-${status}`, status },
      })).toMatchObject({
        state: "queued",
        reviewerExecution: { status, pending: true },
      });
    },
  );
});
