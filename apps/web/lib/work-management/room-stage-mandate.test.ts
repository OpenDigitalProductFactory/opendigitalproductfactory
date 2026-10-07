import { describe, expect, it, vi } from "vitest";

import {
  ACCEPTANCE_VERIFICATION_SHAPE_REF,
  ACCEPTANCE_VERIFIER_WRITES,
} from "./acceptance-verification-shape";
import { workroomDriveTaskId } from "./drive-resolution";
import { loadScheduledRoomMandate, roomStageMandatedTools } from "./room-stage-mandate";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "./workroom-shape-claim";

const CAPSULE = "WC-ACC-AAAA0001";
const TASK = workroomDriveTaskId(CAPSULE, "acceptance-verification");

function room(over: Record<string, unknown> = {}) {
  return {
    capsuleId: CAPSULE,
    status: "working",
    archivedAt: null as Date | null,
    scopeClaims: [
      buildWorkShapeClaim(ACCEPTANCE_VERIFICATION_SHAPE_REF),
      buildWorkShapeRoleBindingsClaim({ "acceptance-verifier": "agent:AGT-WS-PORTFOLIO" }),
    ] as unknown,
    ...over,
  };
}

describe("roomStageMandatedTools (BI-C1781121)", () => {
  it("grants the room-bound agent exactly the writes its stage declares, for the room's own drive task", () => {
    expect(roomStageMandatedTools({ scheduledTaskId: TASK, room: room(), agentIds: ["AGT-WS-PORTFOLIO"] }))
      .toEqual([...ACCEPTANCE_VERIFIER_WRITES].sort());
    // BI-099A0BA3: the objective-mapping writer, which refuses unless the platform issued the room a packet.
    expect(ACCEPTANCE_VERIFIER_WRITES).toEqual(["record_execution_evidence", "record_workroom_evidence", "record_initiative_evidence"]);
  });

  it("grants nothing to any other agent, task, unbound, archived or finished room", () => {
    expect(roomStageMandatedTools({ scheduledTaskId: TASK, room: room(), agentIds: ["AGT-WS-BUILD"] })).toEqual([]);
    expect(roomStageMandatedTools({ scheduledTaskId: "workroom-WC-OTHER-acceptance-verification", room: room(), agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
    expect(roomStageMandatedTools({
      scheduledTaskId: TASK,
      room: room({ scopeClaims: [buildWorkShapeClaim(ACCEPTANCE_VERIFICATION_SHAPE_REF)] }),
      agentIds: ["AGT-WS-PORTFOLIO"],
    })).toEqual([]);
    expect(roomStageMandatedTools({ scheduledTaskId: TASK, room: room({ archivedAt: new Date() }), agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
    expect(roomStageMandatedTools({ scheduledTaskId: TASK, room: room({ status: "complete" }), agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
  });

  it("grants nothing for a shape whose stages declare no mandate", () => {
    const watch = room({ scopeClaims: [buildWorkShapeClaim("obligation-assurance-watch@1.0.0")] });
    expect(roomStageMandatedTools({
      scheduledTaskId: workroomDriveTaskId(CAPSULE, "obligation-assurance-watch"),
      room: watch,
      agentIds: ["compliance-officer"],
    })).toEqual([]);
  });
});

describe("loadScheduledRoomMandate (BI-C1781121)", () => {
  function db(sourceRef: unknown, rooms = [room()]) {
    return {
      taskRun: { findUnique: vi.fn(async () => ({ a2aMetadata: { trigger: "scheduled", sourceRef } })) },
      workroom: {
        findMany: vi.fn(async ({ where }: { where: { capsuleId: { in: string[] } } }) =>
          rooms.filter((candidate) => where.capsuleId.in.includes(candidate.capsuleId))),
      },
    };
  }

  it("resolves the mandate of the room whose drive task started this scheduled run", async () => {
    const fake = db({ kind: "scheduled-task", id: TASK });
    const tools = await loadScheduledRoomMandate(fake, { taskRunId: "TR-SCHED-1234ABCD", agentIds: ["AGT-WS-PORTFOLIO"] });
    expect(tools).toEqual([...ACCEPTANCE_VERIFIER_WRITES].sort());
    expect(fake.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { capsuleId: { in: [CAPSULE] } } }));
  });

  it("uses preloaded run metadata without re-reading the run", async () => {
    const fake = db(null);
    const tools = await loadScheduledRoomMandate(fake, {
      taskRunId: "TR-SCHED-1234ABCD",
      a2aMetadata: { sourceRef: { kind: "scheduled-task", id: TASK } },
      agentIds: ["AGT-WS-PORTFOLIO"],
    });
    expect(tools).toEqual([...ACCEPTANCE_VERIFIER_WRITES].sort());
    expect(fake.taskRun.findUnique).not.toHaveBeenCalled();
  });

  it("is empty for a run that is not scheduled, not a Workroom drive task, or names no room", async () => {
    const fake = db({ kind: "scheduled-task", id: TASK });
    expect(await loadScheduledRoomMandate(fake, { taskRunId: "TR-MCP-abc", agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
    expect(await loadScheduledRoomMandate(fake, { taskRunId: null, agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
    expect(fake.taskRun.findUnique).not.toHaveBeenCalled();
    expect(await loadScheduledRoomMandate(db({ kind: "scheduled-task", id: "marketing-weekly" }), { taskRunId: "TR-SCHED-1", agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
    expect(await loadScheduledRoomMandate(db({ kind: "mcp-token", id: TASK }), { taskRunId: "TR-SCHED-1", agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
    expect(await loadScheduledRoomMandate(db({ kind: "scheduled-task", id: TASK }, []), { taskRunId: "TR-SCHED-1", agentIds: ["AGT-WS-PORTFOLIO"] })).toEqual([]);
  });
});
