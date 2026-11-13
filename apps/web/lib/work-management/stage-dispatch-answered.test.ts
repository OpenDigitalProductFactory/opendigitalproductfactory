import { describe, expect, it } from "vitest";
import { buildDispatchCheckpoint } from "./workroom-drive-checkpoint";
import { loadStageDispatchAnswered, stageDispatchAnswered } from "./stage-dispatch-answered";
import type { RecordedEvidence } from "./stage-evidence-receipts";

// Live, 2026-10-28: room WC-PIR-MCP-EFF-852B5BBE was dispatched at 11:45:00,
// its reviewer recorded the receipt and evidence outcome "completed" at
// 11:51:02, and the stage task's own */15 tick ran it again at 12:00:00 —
// sixteen seconds before the drive stopped the room. The writer refused the
// second review (packet-no-longer-owed) and the run was filed as an error.

const TASK_ID = "workroom-WC-PIR-MCP-EFF-852B5BBE-platform-post-implementation-review";
const STAGE = { tools: [], shapeKey: "platform-post-implementation-review", stageKey: "review", shapeVersion: "1.0.0" };
const DISPATCHED = "2026-10-28T11:45:00.094Z";

function taskConfig(overrides: { taskId?: string; now?: string } = {}) {
  const checkpoint = buildDispatchCheckpoint(null, {
    taskId: overrides.taskId ?? TASK_ID, roomId: "cmvrx7ftn03z601s5cqdtrwui", objective: "Review the merged repair",
    stage: STAGE, holderPrincipalId: null, leaseExpiresAt: "2026-10-28T11:55:00.094Z", now: overrides.now ?? DISPATCHED,
    dispatchScope: { runKey: "r", cycleKey: "c", iteration: 0 },
  });
  return { workroomStage: STAGE, workroomDispatchCheckpoint: checkpoint };
}

const completed: RecordedEvidence = { stageKey: "review", kind: "pir-receipt", outcome: "completed", recordedAt: new Date("2026-10-28T11:51:02.373Z") };

describe("stageDispatchAnswered", () => {
  it("is answered when this dispatch already has completing evidence (the 12:00 re-run)", () => {
    const answer = stageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig(), evidence: [completed] });
    expect(answer).toEqual({ answered: true, roomId: "cmvrx7ftn03z601s5cqdtrwui", stageKey: "review", evidenceRecordedAt: completed.recordedAt });
  });

  it("is not answered by a blocked record", () => {
    expect(stageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig(), evidence: [{ ...completed, outcome: "blocked" }] }).answered).toBe(false);
  });

  it("is not answered by evidence from before this dispatch", () => {
    const earlier = { ...completed, recordedAt: new Date("2026-10-28T11:40:00.000Z") };
    expect(stageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig(), evidence: [earlier] }).answered).toBe(false);
  });

  it("is not answered by another stage's evidence or an undeclared kind", () => {
    expect(stageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig(), evidence: [{ ...completed, stageKey: "plan" }] }).answered).toBe(false);
    expect(stageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig(), evidence: [{ ...completed, kind: "note" }] }).answered).toBe(false);
  });

  it("runs as before when the task carries no checkpoint, or another task's", () => {
    expect(stageDispatchAnswered({ taskId: TASK_ID, taskConfig: { workroomStage: STAGE }, evidence: [completed] }).answered).toBe(false);
    expect(stageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig({ taskId: "workroom-other" }), evidence: [completed] }).answered).toBe(false);
    expect(stageDispatchAnswered({ taskId: TASK_ID, taskConfig: null, evidence: [completed] }).answered).toBe(false);
  });
});

describe("loadStageDispatchAnswered", () => {
  function db(rows: Array<{ payload: unknown; recordedAt: Date }>) {
    const calls: unknown[] = [];
    return {
      calls,
      workroomActivity: {
        findMany: async (args: unknown) => { calls.push(args); return rows; },
      },
    };
  }

  it("reads only this room's evidence since the dispatch and answers from it", async () => {
    const source = db([{ payload: { kind: "pir-receipt", outcome: "completed", stageKey: "review" }, recordedAt: completed.recordedAt }]);
    const answer = await loadStageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig() }, source);
    expect(answer.answered).toBe(true);
    expect(source.calls).toEqual([{
      where: { workCapsuleId: "cmvrx7ftn03z601s5cqdtrwui", kind: "evidence-recorded", recordedAt: { gte: new Date(DISPATCHED) } },
      select: { payload: true, recordedAt: true },
      orderBy: { recordedAt: "desc" },
      take: 50,
    }]);
  });

  it("does not read anything for a task with no checkpoint", async () => {
    const source = db([]);
    expect((await loadStageDispatchAnswered({ taskId: TASK_ID, taskConfig: {} }, source)).answered).toBe(false);
    expect(source.calls).toEqual([]);
  });

  it("fails open when the read fails", async () => {
    const source = { workroomActivity: { findMany: async () => { throw new Error("db down"); } } };
    expect((await loadStageDispatchAnswered({ taskId: TASK_ID, taskConfig: taskConfig() }, source)).answered).toBe(false);
  });
});
