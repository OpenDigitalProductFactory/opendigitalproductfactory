import { describe, expect, it, vi } from "vitest";

import {
  ACCEPTANCE_VERIFICATION_SHAPE_REF,
  ACCEPTANCE_VERIFIER_WRITES,
} from "./acceptance-verification-shape";
import { workroomDriveTaskId } from "./drive-resolution";
import { loadScheduledRoomAuthority, loadScheduledRoomMandate, roomStageMandatedTools } from "./room-stage-mandate";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "./workroom-shape-claim";
import { buildDispatchCheckpoint } from "./workroom-drive-checkpoint";
import { createQualificationExperimentAdmission, qualificationBindingDigest,
  type QualificationExperimentBinding } from "@/lib/backlog/initiative-readiness/qualification-research-admission";

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

describe("standing stage dispatch source at execution", () => {
  function fixture() {
    const source = { repositoryFullName: "owner/repo", headSha: "a".repeat(40) };
    const currentRoom = { ...room(), id: "room-row", ...source,
      workspaceState: { workroomDispatchCheckpoint: { revision: 99, source: { repositoryFullName: "other/repo", headSha: "other" } } } };
    const stage = { shapeKey: "acceptance-verification", shapeVersion: "1.1.0", stageKey: "verify", tools: [...ACCEPTANCE_VERIFIER_WRITES] };
    const checkpoint = buildDispatchCheckpoint(null, { taskId: TASK, roomId: currentRoom.id, source,
      objective: "Verify acceptance", stage, holderPrincipalId: null,
      now: "2026-10-31T00:00:00Z", leaseExpiresAt: "2026-10-31T00:10:00Z" });
    const run = { a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: TASK }, workroomDispatchCheckpoint: checkpoint } };
    const task = { taskId: TASK, taskRunId: "TR-SCHED-SOURCE", agentId: "AGT-WS-PORTFOLIO",
      taskConfig: { workroomStage: stage, workroomDispatchCheckpoint: structuredClone(checkpoint) } };
    const db = { taskRun: { findUnique: vi.fn(async () => run) }, workroom: { findMany: vi.fn(async () => [currentRoom]) },
      scheduledAgentTask: { findUnique: vi.fn(async () => task) } };
    const input = { taskRunId: task.taskRunId, agentIds: [task.agentId], toolName: "record_workroom_evidence",
      params: { capsuleId: CAPSULE, stageKey: "verify", kind: "acceptance-receipt", outcome: "completed", summary: "Acceptance verified" } };
    return { room: currentRoom, task, run, db, input };
  }
  it("uses the task receipt when the room's latest receipt belongs to another branch", async () => {
    const f = fixture();
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual([...ACCEPTANCE_VERIFIER_WRITES].sort());
  });
  it.each(["repositoryFullName", "headSha"] as const)("withholds standing writes after the room changes %s", async field => {
    const f = fixture(); f.room[field] = "changed";
    expect((await loadScheduledRoomAuthority(f.db, f.input)).withheldBecause).toMatch(/source/i);
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual([]);
  });
  it.each(["missing", "different", "malformed"])("withholds a %s run source stamp", async kind => {
    const f = fixture(); const checkpoint = f.run.a2aMetadata.workroomDispatchCheckpoint;
    if (kind === "missing") delete checkpoint.source;
    else if (kind === "different") checkpoint.source!.headSha = "other";
    else Object.assign(checkpoint, { source: { headSha: "a".repeat(40) } });
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual([]);
  });
  it("does not invent source for legacy receipts in a repository-bound room", async () => {
    const f = fixture();
    delete f.run.a2aMetadata.workroomDispatchCheckpoint.source;
    delete f.task.taskConfig.workroomDispatchCheckpoint.source;
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual([]);
  });
  it("rejects a source receipt copied from another dispatch", async () => {
    const f = fixture();
    for (const checkpoint of [f.run.a2aMetadata.workroomDispatchCheckpoint, f.task.taskConfig.workroomDispatchCheckpoint]) {
      checkpoint.confirmedEffect.taskId = "workroom-other-acceptance-verification";
    }
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual([]);
  });
  it("narrows a stale standing dispatch to its exact assigned blocked report", async () => {
    const f = fixture(); f.room.headSha = "changed"; f.input.params.outcome = "blocked";
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual(["record_workroom_evidence"]);
    f.input.params.kind = "note";
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual([]);
    f.input.params.kind = "acceptance-receipt"; f.input.params.capsuleId = "WC-OTHER";
    expect(await loadScheduledRoomMandate(f.db, f.input)).toEqual([]);
  });
});

describe("roomStageMandatedTools (BI-C1781121)", () => {
  it("lets the assigned release coworker report a blocked stage without asking a person", () => {
    const releaseRoom = room({ scopeClaims: [buildWorkShapeClaim("release-readiness-watch@1.0.0")] });
    expect(roomStageMandatedTools({
      scheduledTaskId: workroomDriveTaskId(CAPSULE, "release-readiness-watch"),
      room: releaseRoom,
      agentIds: ["build-specialist"],
      assignedStageKey: "report",
      toolName: "record_workroom_evidence",
      params: { capsuleId: CAPSULE, stageKey: "report", kind: "assurance-finding", outcome: "blocked", summary: "Release identifier is missing." },
    })).toEqual(["record_workroom_evidence"]);
  });

  it.each([
    { capsuleId: "WC-OTHER" }, { stageKey: "cut" }, { stageKey: "invented" },
    { outcome: "completed" }, { outcome: undefined }, { summary: " " }, { summary: undefined }, { kind: "decision-record" },
  ])("does not turn a changed or malformed report into stage authority: %j", (changed) => {
    expect(roomStageMandatedTools({
      scheduledTaskId: workroomDriveTaskId(CAPSULE, "release-readiness-watch"),
      room: room({ scopeClaims: [buildWorkShapeClaim("release-readiness-watch@1.0.0")] }),
      agentIds: ["build-specialist"], assignedStageKey: "report", toolName: "record_workroom_evidence",
      params: { capsuleId: CAPSULE, stageKey: "report", kind: "assurance-finding", outcome: "blocked", summary: "Missing release identifier", ...changed },
    })).toEqual([]);
  });

  it("keeps explicit always-approve policy and unassigned coworkers outside the default report mandate", () => {
    const input = { scheduledTaskId: workroomDriveTaskId(CAPSULE, "release-readiness-watch"),
      room: room({ scopeClaims: [buildWorkShapeClaim("release-readiness-watch@1.0.0")] }),
      agentIds: ["build-specialist"], assignedStageKey: "report", toolName: "record_workroom_evidence",
      params: { capsuleId: CAPSULE, stageKey: "report", kind: "assurance-finding", outcome: "blocked", summary: "Missing release identifier" } };
    expect(roomStageMandatedTools({ ...input, allowBlockedReport: false })).toEqual([]);
    expect(roomStageMandatedTools({ ...input, assignedStageKey: null })).toEqual([]);
    expect(roomStageMandatedTools({ ...input, assignedStageKey: "sweep" })).toEqual([]);
    expect(roomStageMandatedTools({ ...input, agentIds: ["customer-advisor"] })).toEqual([]);
    expect(roomStageMandatedTools({ ...input, toolName: "request_self_upgrade" })).toEqual([]);
    expect(roomStageMandatedTools({ ...input, room: { ...input.room, archivedAt: new Date() } })).toEqual([]);
  });

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

  it("resolves the release report call from the recorded scheduled source", async () => {
    const taskId = workroomDriveTaskId(CAPSULE, "release-readiness-watch");
    const fake = db({ kind: "scheduled-task", id: taskId }, [room({ scopeClaims: [buildWorkShapeClaim("release-readiness-watch@1.0.0")] })]);
    const assignment = { agentId: "build-specialist", taskRunId: "TR-SCHED-REPORT", taskConfig: {
      workroomStage: { shapeKey: "release-readiness-watch", shapeVersion: "1.0.0", stageKey: "report", tools: [] },
    } };
    const scheduledAgentTask = { findUnique: vi.fn().mockResolvedValue(assignment) };
    const input = { taskRunId: "TR-SCHED-REPORT", agentIds: ["build-specialist"],
      toolName: "record_workroom_evidence", params: { capsuleId: CAPSULE, stageKey: "report", kind: "assurance-finding", outcome: "blocked", summary: "Missing release identifier" } };
    expect(await loadScheduledRoomMandate({ ...fake, scheduledAgentTask }, input))
      .toEqual(["record_workroom_evidence"]);
    for (const changed of [null, { ...assignment, taskRunId: "TR-SCHED-OLD" }, { ...assignment, agentId: "someone-else" },
      { ...assignment, taskConfig: { workroomStage: { shapeKey: "other", shapeVersion: "1.0.0", stageKey: "report" } } }]) {
      scheduledAgentTask.findUnique.mockResolvedValue(changed);
      expect(await loadScheduledRoomMandate({ ...fake, scheduledAgentTask }, input)).toEqual([]);
    }
  });

  it("enforces verification phase parameters at the actual scheduled mandate boundary", async () => {
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-mandate-secret");
    const taskId = workroomDriveTaskId(CAPSULE, "release-readiness-watch");
    const headSha = "d".repeat(40);
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "verify", itemId: "BI-QUAL", workroomId: CAPSULE,
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha,
      protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: "principal-1", protocolReviewReceiptId: "review-protocol-1",
      shapeKey: "release-readiness-watch", shapeVersion: "1.0.0", stageKey: "report", policyVersion: 1,
      executorMode: "sandbox-build", requiredPlatform: "linux",
      targetProductionBlobIds: ["e".repeat(40)], allowedPaths: ["apps/web/lib/example.test.ts"],
      permittedTools: ["run_sandbox_tests", "record_workroom_evidence"],
      issuedAt: "2026-06-18T11:00:00.000Z", expiresAt: "2026-06-18T13:00:00.000Z",
      maxStarts: 1, maxDurationMs: 600_000,
      candidate: { headSha, diffDigest: `sha256:${"f".repeat(64)}`, testBlobIds: ["1".repeat(40)],
        productionBytesUnchanged: true, reviewReceiptId: "review-1" },
    };
    const token = createQualificationExperimentAdmission(binding);
    const metadata = { sourceRef: { kind: "scheduled-task", id: taskId }, qualificationExperiment: binding };
    const run = { a2aMetadata: metadata, status: "working", archivedAt: null, currentAgentId: "build-specialist",
      userId: "user-1" };
    const qualificationRoom = room({ backlogItemId: binding.itemId, repositoryFullName: binding.repositoryFullName,
      baseSha: binding.baseSha, headSha: binding.headSha, leaseHolderPrincipalId: binding.accountablePrincipalRef,
      leaseExpiresAt: new Date("2026-06-18T12:00:00.000Z"),
      scopeClaims: [buildWorkShapeClaim("release-readiness-watch@1.0.0")],
      workspaceState: { qualificationExperimentAdmission: { schemaVersion: 1, status: "started", token,
        bindingDigest: qualificationBindingDigest(binding), startCount: 1, issuedAt: binding.issuedAt,
        startedAt: "2026-06-18T11:05:00.000Z", taskId } } });
    const task = { taskId, ownerUserId: "user-1", agentId: "build-specialist", taskRunId: "TR-SCHED-QUAL",
      isActive: true, taskConfig: { workroomStage: { shapeKey: binding.shapeKey, shapeVersion: binding.shapeVersion,
        stageKey: binding.stageKey, tools: binding.permittedTools, qualificationExperiment: binding } } };
    const fake = { taskRun: { findUnique: vi.fn().mockResolvedValue(run) }, workroom: { findMany: vi.fn().mockResolvedValue([qualificationRoom]) },
      scheduledAgentTask: { findUnique: vi.fn().mockResolvedValue(task) } };
    const base = { taskRunId: "TR-SCHED-QUAL", a2aMetadata: metadata, agentIds: ["build-specialist"],
      toolName: "run_sandbox_tests" };
    expect((await loadScheduledRoomAuthority(fake, { ...base, params: { auto_fix: true } },
      { now: () => new Date("2026-06-18T11:06:00.000Z"),
        loadAgentGrants: async () => ["sandbox_execute", "workroom_evidence_write"] })).withheldBecause).toMatch(/outside/i);
    expect((await loadScheduledRoomAuthority(fake, { ...base, params: { auto_fix: false } },
      { now: () => new Date("2026-06-18T11:06:00.000Z"),
        loadAgentGrants: async () => ["sandbox_execute", "workroom_evidence_write"] })).mandatedTools).toEqual([]);
    expect((await loadScheduledRoomAuthority(fake, { ...base, params: { auto_fix: false } },
      { now: () => new Date("2026-06-18T11:06:00.000Z"), loadAgentGrants: async () => [] })).mandatedTools).toEqual([]);
    for (const changed of [
      { archivedAt: new Date("2026-06-18T11:05:30.000Z") }, { status: "completed" },
      { repositoryFullName: "other/repo" }, { baseSha: "2".repeat(40) }, { headSha: "3".repeat(40) },
      { leaseHolderPrincipalId: "principal-other" }, { leaseExpiresAt: new Date("2026-06-18T11:05:59.000Z") },
    ]) {
      fake.workroom.findMany.mockResolvedValue([{ ...qualificationRoom, ...changed }]);
      expect((await loadScheduledRoomAuthority(fake, { ...base, params: { auto_fix: false } },
        { now: () => new Date("2026-06-18T11:06:00.000Z"),
          loadAgentGrants: async () => ["sandbox_execute", "workroom_evidence_write"] })).mandatedTools,
      `changed room must withhold: ${JSON.stringify(changed)}`).toEqual([]);
    }
    fake.workroom.findMany.mockResolvedValue([qualificationRoom]);
    fake.taskRun.findUnique.mockResolvedValue({ ...run, currentAgentId: "other-agent" });
    expect((await loadScheduledRoomAuthority(fake, { ...base, params: { auto_fix: false } },
      { now: () => new Date("2026-06-18T11:06:00.000Z"),
        loadAgentGrants: async () => ["sandbox_execute", "workroom_evidence_write"] })).mandatedTools).toEqual([]);
    vi.unstubAllEnvs();
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
