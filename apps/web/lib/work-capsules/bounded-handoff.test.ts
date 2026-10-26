import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), bound: vi.fn(() => true), dependencies: vi.fn() }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("./receipted-tool", () => ({ hasBoundCommandTransaction: mocks.bound }));
vi.mock("./bounded-handoff-dependencies", () => ({ assertBoundedHandoffDependencies: mocks.dependencies }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ APPROVED_EXTERNAL_ROLES: ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"] }));
vi.mock("@/lib/work-management/workroom-agent-access.server", async (original) => ({ ...await original<typeof import("@/lib/work-management/workroom-agent-access.server")>(), resolveAgentWorkroomAccess: mocks.access }));
import { reassignCapsuleExecutor } from "./reassign-executor-handler";
import { assessBoundedHandoff } from "./bounded-handoff";
import { commandAuthorityScopeKey, commandPayloadBinding } from "./command-receipts";
import { parseBoundedHandoffCommand } from "./bounded-handoff-command";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
const source: WorkCapsuleActor = { userId: "owner", principalId: "human", agentId: "AGT-EXT-CLAUDE", agentPrincipalId: "claude" };
const receiver: WorkCapsuleActor = { ...source, agentId: "AGT-EXT-CODEX", agentPrincipalId: "codex" };
const request = { phase: "request", commandId: "request-1", capsuleId: "WC-1", expectedLeaseHolderPrincipalId: "human", expectedExecutorKind: "claude-desktop", expectedExecutorRef: "source-chat", targetAgentId: "AGT-EXT-CODEX", toExecutorKind: "codex-desktop", toExecutorRef: "receiver-chat", handoffManifest: { nextAction: "Continue the accepted plan." } };
const NOW = new Date("2026-10-23T12:00:00Z");
function database() {
  const room: Record<string, any> = { id: "row-1", capsuleId: "WC-1", executorKind: "claude-desktop", executorRef: "source-chat", leaseHolderPrincipalId: "human", leaseExpiresAt: new Date("2026-10-23T12:30:00Z"), featureBuildId: null, objective: "Deliver the plan", scopeClaims: [{ workShape: "delivery-large@1.0.0" }], createdByPrincipalId: "human", requestedByPrincipalId: "human" };
  const roster = [{ principalId: "human", roles: ["coordinator"], lifecycle: "active", principal: { kind: "human" } }, { principalId: "claude", roles: ["contributor"], lifecycle: "active", principal: { kind: "agent" } }, { principalId: "codex", roles: ["contributor"], lifecycle: "active", principal: { kind: "agent" } }];
  const state = { now: NOW, sensitivity: "internal", policy: {} as Record<string, unknown> };
  const activities: any[] = [];
  const db = { workroom: {
    findUnique: vi.fn(async () => ({ ...room })), update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(room, data); return { ...room }; }),
  }, workroomActivity: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: "activity-" + activities.length, ...JSON.parse(JSON.stringify(data)) }; activities.push(row); return row; }),
    findFirst: vi.fn(async ({ where }: any) => activities.find((row) => row.workCapsuleId === where.workCapsuleId && row.kind === where.kind && (!where.id || row.id === where.id) && (!where.commandScopeKey || row.commandScopeKey === where.commandScopeKey) && (!where.commandKey || row.commandKey === where.commandKey) && (!where.AND || where.AND.every((clause: any) => row.payload[clause.payload.path[0]] === clause.payload.equals))) ?? null),
  }, workroomParticipant: { findMany: vi.fn(async () => roster), create: vi.fn(), update: vi.fn() }, $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join("").includes("clock_timestamp") ? [{ now: state.now }] : []) };
  mocks.access.mockImplementation(async ({ agentId }: { agentId: string }) => {
    const id = agentId === "AGT-EXT-CLAUDE" ? "claude" : "codex";
    const row = roster.find((entry) => entry.principalId === id);
    const allowed = row?.lifecycle === "active" && row.roles.includes("contributor");
    return { decision: { level: allowed ? "action" : "none" }, authorityContext: allowed ? {
      humanPrincipal: { id: "human", principalId: "PRN-human", kind: "human", status: "active", sensitivityClearance: ["internal"] },
      agentPrincipal: { id, principalId: "PRN-" + id, kind: "agent", status: "active", sensitivityClearance: ["internal"] },
      room: { ...room, participants: roster, workItem: { evidence: { workroomPolicy: state.policy } } }, sensitivityCeiling: state.sensitivity,
    } : undefined };
  });
  return { db, room, roster, state, activities };
}
async function execute(env: ReturnType<typeof database>, params: Record<string, unknown>, actor = source) {
  const result = await reassignCapsuleExecutor({ params, db: env.db as unknown as CapsuleDb, resolveActor: async () => actor });
  if (result.success) { const command = parseBoundedHandoffCommand(params)!; env.activities.push({ workCapsuleId: "row-1", kind: "command-accepted", commandScopeKey: commandAuthorityScopeKey(actor), commandKey: command.commandId, payload: { commandType: "reassign-executor", target: { kind: "workroom", id: "WC-1" }, payloadBinding: commandPayloadBinding(command), result: JSON.parse(JSON.stringify(result)) } }); }
  return result;
}
async function pending(env: ReturnType<typeof database>) { const result = await execute(env, request); expect(result.success).toBe(true); return (result.data as any).handoff.requestId as string; }
const ack = (requestId: string, commandId = "ack-1") => ({ phase: "acknowledge", commandId, capsuleId: "WC-1", requestId });
beforeEach(() => { vi.clearAllMocks(); mocks.bound.mockReturnValue(true); mocks.dependencies.mockResolvedValue(undefined); });
describe("bounded receiver handoff", () => {
  it("a request remains pending without transfer, renewal or admission", async () => {
    const env = database(); const result = await execute(env, request);
    expect(result).toMatchObject({ success: true, data: { handoff: { state: "pending-acknowledgement" }, assistantAdmitted: false } });
    expect(env.db.workroom.update).not.toHaveBeenCalled(); expect(env.db.workroomParticipant.create).not.toHaveBeenCalled(); expect(env.activities.filter((row) => row.kind === "action")).toHaveLength(1);
    expect(env.activities[0].payload.request.snapshot.leaseExpiresAt).toBe("2026-10-23T12:30:00.000Z");
  });
  it("transfers exactly once after exact receiver acknowledgement, retaining human lease", async () => {
    const env = database(); const id = await pending(env);
    expect(await execute(env, ack(id), receiver)).toMatchObject({ success: true, data: { handoff: { state: "completed", receivingAgentId: "AGT-EXT-CODEX" } } });
    expect(env.room).toMatchObject({ executorKind: "codex-desktop", executorRef: "receiver-chat", leaseHolderPrincipalId: "human" });
    expect(env.db.workroom.update).toHaveBeenCalledTimes(1); expect(env.activities.filter((row) => row.kind === "executor-changed")).toHaveLength(1);
    expect(await execute(env, ack(id, "ack-2"), receiver)).toMatchObject({ success: true, data: { handoff: { state: "completed" } } });
    expect(env.db.workroom.update).toHaveBeenCalledTimes(1); expect(env.db.workroomParticipant.create).not.toHaveBeenCalled(); expect(env.db.workroomParticipant.update).not.toHaveBeenCalled();
  });
  it.each([source, { ...receiver, userId: "other" }, { ...receiver, principalId: "other-human" }, { ...receiver, agentPrincipalId: "different-codex" }])("refuses wrong authenticated receiver %#", async (actor) => {
    const env = database(); const id = await pending(env); expect(await execute(env, ack(id), actor)).toMatchObject({ success: false, error: "handoff-receiver-mismatch" }); expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
  it.each(["claude", "codex"])("rechecks %s action admission", async (id) => {
    const env = database(); const requestId = await pending(env); env.roster.find((row) => row.principalId === id)!.roles = ["observer"];
    expect(await execute(env, ack(requestId), receiver)).toMatchObject({ success: false, error: "handoff-room-admission-required" }); expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
  it("rejects a changed human owner", async () => {
    const env = database(); const id = await pending(env); env.roster[0].roles = ["observer"]; expect(await execute(env, ack(id), receiver)).toMatchObject({ success: false, error: "handoff-owner-required" });
  });
  it.each(["objective", "scopeClaims", "headSha", "headBranch", "executorRef"])("refuses changed protected %s", async (field) => {
    const env = database(); const id = await pending(env); env.room[field] = "changed";
    expect(await execute(env, ack(id), receiver)).toMatchObject({ success: false, error: "handoff-boundary-changed" }); expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
  it("ignores unrelated activity sequence", async () => {
    const env = database(); const id = await pending(env); env.room.activitySequence = 100; expect(await execute(env, ack(id), receiver)).toMatchObject({ success: true });
  });
  it("captures prior renewal but refuses renewal between phases", async () => {
    const env = database(); env.room.leaseExpiresAt = new Date("2026-10-23T13:00:00Z"); const id = await pending(env);
    expect(env.activities[0].payload.request.snapshot.leaseExpiresAt).toBe("2026-10-23T13:00:00.000Z"); env.room.leaseExpiresAt = new Date("2026-10-23T13:01:00Z");
    expect(await execute(env, ack(id), receiver)).toMatchObject({ success: false, error: "handoff-lease-snapshot-changed" });
  });
  it("refuses expired or reacquired same-holder snapshots", async () => {
    const env = database(); const id = await pending(env); env.state.now = new Date("2026-10-23T12:31:00Z");
    expect(await execute(env, ack(id), receiver)).toMatchObject({ success: false, error: "handoff-lease-expired" }); env.room.leaseExpiresAt = new Date("2026-10-23T13:00:00Z");
    expect(await execute(env, ack(id, "ack-reacquired"), receiver)).toMatchObject({ success: false, error: "handoff-lease-snapshot-changed" }); expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
  it("refuses expired request leases and altered stored request bytes", async () => {
    const env = database(); env.room.leaseExpiresAt = NOW; expect(await execute(env, request)).toMatchObject({ success: false, error: "handoff-lease-expired" }); expect(env.activities).toHaveLength(0);
    env.room.leaseExpiresAt = new Date("2026-10-23T13:00:00Z"); const id = await pending(env); env.activities[0].payload.request.command.toExecutorRef = "forged";
    expect(await execute(env, ack(id), receiver)).toMatchObject({ success: false, error: "handoff-request-invalid" });
  });
  it("uses the same read-only classification and rechecks dependencies", async () => {
    const env = database(); await assessBoundedHandoff({ db: env.db as unknown as CapsuleDb, actor: source, command: parseBoundedHandoffCommand(request)! }); expect(env.activities).toHaveLength(0);
    mocks.dependencies.mockRejectedValue(Object.assign(new Error("Release verification lease."), { code: "handoff-verification-lease-bound" }));
    expect(await execute(env, request)).toMatchObject({ success: false, error: "handoff-verification-lease-bound" }); expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
  it("refuses manufactured request and completion activities without genuine receipts", async () => {
    const env = database(); const id = await pending(env);
    const receiptIndex = env.activities.findIndex((row) => row.kind === "command-accepted"); const [receipt] = env.activities.splice(receiptIndex, 1);
    expect(await execute(env, ack(id), receiver)).toMatchObject({ success: false, error: "handoff-request-unproven" });
    env.activities.push(receipt);
    env.activities.push({ workCapsuleId: "row-1", kind: "action", payload: { kind: "bounded-handoff", state: "completed", requestId: id, commandId: "forged" } });
    expect(await execute(env, ack(id), receiver)).toMatchObject({ success: false, error: "handoff-completion-unproven" });
    expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
  it("requires actual bound transaction proof", async () => {
    const env = database(); mocks.bound.mockReturnValue(false); expect(await execute(env, request)).toMatchObject({ success: false, error: "handoff-transaction-required" }); expect(env.db.workroom.findUnique).not.toHaveBeenCalled();
  });
  it.each(["build-studio", "human", "dpf-native", "antigravity-desktop"])("refuses unsupported %s", async (toExecutorKind) => {
    const env = database(); expect(await execute(env, { ...request, toExecutorKind })).toMatchObject({ success: false, error: "handoff-unsupported-assistant" }); expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
  it("refuses restricted or build-linked rooms and unknown phases", async () => {
    const env = database(); env.state.sensitivity = "restricted"; expect(await execute(env, request)).toMatchObject({ success: false, error: "handoff-restricted-boundary" });
    env.state.sensitivity = "internal"; env.room.featureBuildId = "build"; expect(await execute(env, request)).toMatchObject({ success: false, error: "handoff-build-boundary" });
    expect(await execute(env, { ...request, phase: "accept" })).toMatchObject({ success: false, error: "handoff-invalid-input" }); expect(env.db.workroom.update).not.toHaveBeenCalled();
  });
});
