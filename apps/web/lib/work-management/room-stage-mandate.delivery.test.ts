import { describe, expect, it } from "vitest";
import { withWorkroomPostureClaim } from "./workroom-posture-claim";
import { loadScheduledRoomMandate, loadScheduledRoomAuthority } from "./room-stage-mandate";
import { buildWorkShapeRoleBindingsClaim, buildWorkShapeClaim } from "./workroom-shape-claim";
import { scheduledDeliveryFixture, SCHEDULED_DELIVERY_NOW as NOW } from "./__fixtures__/scheduled-delivery-authority";

describe("scheduled delivery author evidence (BI-D95FD249)", () => {
  it("reuses live author authorization for the exact dispatched room and stage", async () => {
    const fixture = scheduledDeliveryFixture();
    expect(await loadScheduledRoomMandate(fixture.db, fixture.input, fixture.deps))
      .toEqual(["record_workroom_evidence"]);
  });
});

type Fixture = ReturnType<typeof scheduledDeliveryFixture>;
const denied: Array<[string, (f: Fixture) => void]> = [
  ["foreign room effect", f => { f.input.params.capsuleId = "WC-OTHER"; }],
  ["foreign stage effect", f => { f.input.params.stageKey = "reproduce"; }],
  ["undeclared evidence kind", f => { f.input.params.kind = "acceptance-receipt"; }],
  ["blank evidence summary", f => { f.input.params.summary = "  "; }],
  ["invalid outcome", f => { f.input.params.outcome = "approved"; }],
  ["different calling actor", f => { f.input.agentIds = ["other-agent"]; }],
  ["changed run actor", f => { f.run.currentAgentId = "other-agent"; }],
  ["changed task actor", f => { f.task.agentId = "other-agent"; }],
  ["different task owner", f => { f.task.ownerUserId = "other-owner"; }],
  ["inactive scheduled task", f => { f.task.isActive = false; }],
  ["archived run", f => { f.run.archivedAt = NOW; }],
  ["archived room", f => { f.room.archivedAt = NOW; }],
  ["completed room", f => { f.room.status = "complete"; }],
  ["missing run snapshot", f => { Reflect.deleteProperty(f.run.a2aMetadata, "workroomDispatchCheckpoint"); }],
  ["superseded room generation", f => { f.room.workspaceState.workroomDispatchCheckpoint.revision++; }],
  ["superseded task generation", f => { f.task.taskConfig.workroomDispatchCheckpoint.revision++; }],
  ["changed task stage", f => { f.task.taskConfig.workroomStage.stageKey = "reproduce"; }],
  ["room advanced to another stage", f => { f.room.workspaceState.workroomDrive.stageKey = "runtime-check"; }],
  ["different actual source task", f => { f.run.a2aMetadata.sourceRef.id = "workroom-other-delivery-small"; }],
  ["different actual source kind", f => { f.run.a2aMetadata.sourceRef.kind = "external-mcp"; }],
  ["run predates dispatch", f => { f.run.startedAt = new Date(NOW.getTime() - 2000); }],
  ["expired dispatch", f => { f.deps.now = () => new Date(NOW.getTime() + 600_001); }],
  ["revoked current tool grant", f => { f.deps.loadAgentGrants.mockResolvedValue([]); }],
  ["missing participant membership", f => { f.roomTurn.memberOfRoom = false; }],
  ["observer-only turn", f => { f.roomTurn.handsOn.enabled = false; }],
  ["room excludes evidence grant", f => { f.roomTurn.authorizedGrants = ["backlog_read"]; }],
  ["explicit author bound elsewhere", f => { f.room.scopeClaims = [
    buildWorkShapeClaim("delivery-small@1.0.0"), buildWorkShapeRoleBindingsClaim({ author: "agent:other-agent" })]; }],
];
describe("delivery authority negative controls (BI-D95FD249)", () => {
  it.each(denied)("%s", async (_name, change) => {
    const f = scheduledDeliveryFixture(); change(f);
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it.each(["completed", "canceled", "failed", "input-required", "archived", "paused-for-upgrade", "submitted"])(
    "does not authorize a %s run", async status => {
      const f = scheduledDeliveryFixture(); f.run.status = status;
      expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
    });
  it.each(["propose", "advise"] as const)("retains explicit %s scope", async actionBoundary => {
    const f = scheduledDeliveryFixture();
    f.room.scopeClaims = withWorkroomPostureClaim(f.room.scopeClaims, { actionBoundary }, NOW);
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it.each(["revoked authorization", "unfunded work", "unreadable funding"])("withholds %s", async because => {
    const f = scheduledDeliveryFixture();
    f.deps.loadAuthorStageAutonomy.mockResolvedValue(() => ({ roleBindings: {}, withheldBecause: because }));
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it("fails closed on an authority read failure", async () => {
    const f = scheduledDeliveryFixture(); f.deps.loadAuthorStageAutonomy.mockRejectedValue(new Error("unavailable"));
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it.each(["record_initiative_design_review", "record_initiative_evidence", "request_self_upgrade"])(
    "does not mandate %s", async toolName => {
      const f = scheduledDeliveryFixture(); f.input.toolName = toolName;
      expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
    });
  it("cannot authorize a governed merge stage", async () => {
    const f = scheduledDeliveryFixture();
    for (const c of [f.room.workspaceState.workroomDispatchCheckpoint,
      f.task.taskConfig.workroomDispatchCheckpoint, f.run.a2aMetadata.workroomDispatchCheckpoint]) c.stage.stageKey = "merge";
    f.room.workspaceState.workroomDrive.stageKey = "merge";
    f.task.taskConfig.workroomStage.stageKey = "merge"; f.input.params.stageKey = "merge";
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it("narrows attachment context without creating general room preauthorization", async () => {
    const f = scheduledDeliveryFixture();
    const attachment = { taskRunId: f.input.taskRunId, agentIds: f.input.agentIds };
    const authority = await loadScheduledRoomAuthority(f.db, attachment, f.deps);
    expect(authority.mandatedTools).toEqual(["record_workroom_evidence"]);
    expect(authority.roomTurn?.workroomId).toBe(f.room.capsuleId);
    expect(authority.roomTurn?.actionBoundary).toBe("propose");
    expect(await loadScheduledRoomMandate(f.db, attachment, f.deps)).toEqual([]);
  });
});

describe("blocked author evidence (BI-D95FD249)", () => {
  it("records a scoped blocked note without asking for another human envelope", async () => {
    const f = scheduledDeliveryFixture();
    f.input.params.kind = "note"; f.input.params.outcome = "blocked";
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual(["record_workroom_evidence"]);
  });
});


describe("dispatch provenance and restricted room turns", () => {
  it("accepts a server-fenced dispatch with a nullable lease holder", async () => {
    const f = scheduledDeliveryFixture();
    for (const c of [f.room.workspaceState.workroomDispatchCheckpoint,
      f.task.taskConfig.workroomDispatchCheckpoint, f.run.a2aMetadata.workroomDispatchCheckpoint]) {
      c.authority.holderPrincipalId = null;
    }
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual(["record_workroom_evidence"]);
  });
  it("withholds a dispatch from an earlier drive cycle even at the same stage", async () => {
    const f = scheduledDeliveryFixture(); f.room.workspaceState.workroomDrive.runKey = "cycle-2";
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it.each(["advise", "propose"] as const)("preserves a read/proposal turn under explicit %s scope", async actionBoundary => {
    const f = scheduledDeliveryFixture();
    f.room.scopeClaims = withWorkroomPostureClaim(f.room.scopeClaims, { actionBoundary }, NOW);
    f.roomTurn.actionBoundary = actionBoundary;
    const authority = await loadScheduledRoomAuthority(f.db, f.input, f.deps);
    expect(authority.mandatedTools).toEqual([]);
    expect(authority.roomTurn?.actionBoundary).toBe(actionBoundary);
    expect(authority.withheldBecause).toBeNull();
  });
});


describe("current assignment and explicit approval policy", () => {
  it("preserves an explicit always-review decision", async () => {
    const f = scheduledDeliveryFixture(); Object.assign(f.input, { allowBlockedReport: false });
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it("does not admit the replaced run even when its dispatch snapshot matches", async () => {
    const f = scheduledDeliveryFixture(); Object.assign(f.task, { taskRunId: "TR-SCHED-REPLACEMENT" });
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
  it("withholds completion after the room owner changes", async () => {
    const f = scheduledDeliveryFixture(); Object.assign(f.room, { ownerUserId: "new-owner" });
    expect(await loadScheduledRoomMandate(f.db, f.input, f.deps)).toEqual([]);
  });
});
