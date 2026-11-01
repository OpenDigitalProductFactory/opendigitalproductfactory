import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduledDeliveryFixture, SCHEDULED_DELIVERY_NOW } from "./__fixtures__/scheduled-delivery-authority";
import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
const state = vi.hoisted(() => ({ fixture: null as ReturnType<typeof scheduledDeliveryFixture> | null }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ get prisma() { return state.fixture?.db; } }));
vi.mock("./author-stage-autonomy-live", () => ({
  loadAuthorStageAutonomy: (...args: unknown[]) => state.fixture!.deps.loadAuthorStageAutonomy(...args as []),
}));
vi.mock("./room-turn-authority.server", () => ({
  loadRoomTurnAuthority: (...args: unknown[]) => state.fixture!.deps.loadRoomTurnAuthority(...args as []),
}));
vi.mock("@/lib/tak/agent-grants", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  getAgentToolGrantsAsync: (...args: unknown[]) => state.fixture!.deps.loadAgentGrants(...args as []),
}));
vi.mock("@/lib/queue/functions/workroom-drive-task-owner", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  // The live owner rule is exercised in its own suite; here the room's recorded user owns the task.
  resolveRoomDriveTaskOwnerUserId: async (room: { recordedOwnerUserId: string | null }) => room.recordedOwnerUserId,
}));
vi.mock("@/lib/identity/load-effective-auth-context", () => ({
  loadEffectiveAuthContext: async () => ({ actingHumanUserId: "owner", sensitivityClearance: ["public", "internal"],
    actingAgentId: coworkerAuthorityAgentId(state.fixture!.task.agentId) }),
}));
vi.mock("@/lib/coworker/authority-approval-envelope", () => ({ findApprovedAuthorityEnvelope: async () => null }));
import { interceptToolCallAsProposal } from "@/lib/proactivity/propose-interception";
import { resolveCoworkerToolAuthorityInput } from "@/lib/govern/authority/resolve-coworker-tool-authority";
import { enforceCoworkerToolAuthority, setCoworkerToolAuthorityOverridesForTests } from "@/lib/govern/authority/coworker-tool-authority-gate";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import { toRoomAuthorityContext } from "./room-turn-authority";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "./workroom-shape-claim";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SCHEDULED_DELIVERY_NOW); state.fixture = scheduledDeliveryFixture(); });
afterEach(() => {
  vi.useRealTimers();
  setCoworkerToolAuthorityOverridesForTests({ resolveCoworkerAuthorityInput: null,
    authorizationDecisionCreate: null, authorityApprovalEnvelopeCreate: null,
    policyAuthorityProjectionAttempt: null, authorityExecutedOutcome: null });
});
const tool = { name: "record_workroom_evidence", description: "Record stage evidence", inputSchema: {},
  requiredCapability: null, sideEffect: true, executionMode: "immediate" as const };

async function resolveEvidenceAuthority(f: ReturnType<typeof scheduledDeliveryFixture>, args: Record<string, unknown>, context: GovernedExecuteArgs["context"] = {}) {
  const db = { ...f.db, agent: { findFirst: async () => ({ id: "agent-row",
      agentId: coworkerAuthorityAgentId(f.task.agentId), sensitivity: "internal", hitlTierDefault: 2, governanceProfile: f.agent.governanceProfile ? { ...f.agent.governanceProfile, updatedAt: SCHEDULED_DELIVERY_NOW } : null }) } };
  return resolveCoworkerToolAuthorityInput({
      execution: { source: "agentic-loop", toolName: tool.name, rawParams: args, userId: "owner",
        userContext: { platformRole: "admin", isSuperuser: true },
        context: { agentId: f.task.agentId, taskRunId: f.run.taskRunId, routeContext: "/ops/workrooms",
          roomAuthority: toRoomAuthorityContext({ ...f.roomTurn, actionBoundary: "propose" }) ?? undefined, ...context } },
      tool, agentGrantAllowed: true,
    }, db as never);
}

describe("scheduled delivery proposal and reference-monitor flow", () => {
  it.each([
    ["delivery", "repositoryFullName"], ["delivery", "headSha"],
    ["standing", "repositoryFullName"], ["standing", "headSha"],
  ] as const)("withholds a stale %s %s effect at the monitor without a new approval", async (lane, field) => {
    const f = state.fixture!;
    const source = { repositoryFullName: "owner/repo", headSha: "a".repeat(40) };
    const room = Object.assign(f.room, source);
    for (const checkpoint of [f.room.workspaceState.workroomDispatchCheckpoint,
      f.task.taskConfig.workroomDispatchCheckpoint, f.run.a2aMetadata.workroomDispatchCheckpoint]) checkpoint.source = { ...source };
    if (lane === "standing") {
      const stage = { shapeKey: "acceptance-verification", shapeVersion: "1.1.0", stageKey: "verify", tools: [tool.name] };
      f.room.scopeClaims = [buildWorkShapeClaim("acceptance-verification@1.1.0"),
        buildWorkShapeRoleBindingsClaim({ "acceptance-verifier": `agent:${f.task.agentId}` })];
      f.task.taskId = `workroom-${f.room.capsuleId}-acceptance-verification`;
      f.task.taskConfig.workroomStage = stage;
      f.run.a2aMetadata.sourceRef.id = f.task.taskId;
      for (const checkpoint of [f.room.workspaceState.workroomDispatchCheckpoint,
        f.task.taskConfig.workroomDispatchCheckpoint, f.run.a2aMetadata.workroomDispatchCheckpoint]) {
        checkpoint.stage = stage; checkpoint.confirmedEffect.taskId = f.task.taskId;
      }
      f.input.params.stageKey = "verify"; f.input.params.kind = "acceptance-receipt";
    }
    const attachment = lane === "standing" ? { roomAuthority: undefined } : {};
    // The run attached while source was current; the live effect sees its change.
    expect((await resolveEvidenceAuthority(f, f.input.params, attachment)).steering).toBe("scheduled-mandate");
    room[field] = "changed";
    const createApproval = vi.fn(); const effect = vi.fn();
    setCoworkerToolAuthorityOverridesForTests({
      resolveCoworkerAuthorityInput: ({ execution }) => resolveEvidenceAuthority(f, f.input.params, { ...attachment, ...execution.context }),
      authorizationDecisionCreate: async () => ({}), authorityApprovalEnvelopeCreate: createApproval,
      policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }), authorityExecutedOutcome: async () => null,
    });
    const execute = vi.fn(async (context: GovernedExecuteArgs["context"]) => {
      const decision = await enforceCoworkerToolAuthority({ source: "agentic-loop", toolName: tool.name,
        rawParams: f.input.params, userId: "owner", userContext: { platformRole: "admin", isSuperuser: true },
        context: { agentId: f.task.agentId, taskRunId: f.run.taskRunId, ...context } }, tool, true);
      if (decision.outcome === "allow") effect();
      expect(decision).toMatchObject({ outcome: "reject", rejection: "authority_denied", message: expect.stringMatching(/No new approval request/) });
      return { success: false, error: "authority_denied", message: "Stale source was not run." };
    });
    expect(await interceptToolCallAsProposal({ toolDef: tool, proposeSideEffects: lane === "delivery", toolName: tool.name,
      args: f.input.params, agentId: f.task.agentId, threadId: "thread", routeContext: "/ops/workrooms",
      taskRunId: f.run.taskRunId, execute })).toMatchObject({ success: false, error: "authority_denied" });
    expect(execute).toHaveBeenCalledWith({ proposeBoundary: true, approvalCompletion: "platform", allowApprovalRequest: false });
    expect((await resolveEvidenceAuthority(f, f.input.params, attachment)).steering).toBe("none");
    expect(effect).not.toHaveBeenCalled(); expect(createApproval).not.toHaveBeenCalled();
  });
  it.each(["completed", "blocked"])("reuses the exact stage mandate for %s evidence", async outcome => {
    const f = state.fixture!;
    const args = { ...f.input.params, outcome, ...(outcome === "blocked" ? { kind: "note" } : {}) };
    const propose = vi.fn(async () => ({ success: false, message: "Unexpected approval", error: "approval_required", data: { envelopeId: "unexpected" } }));
    expect(await interceptToolCallAsProposal({
      toolDef: tool, proposeSideEffects: true, toolName: tool.name, args, agentId: f.task.agentId,
      threadId: "thread", routeContext: "/ops/workrooms", taskRunId: f.run.taskRunId, execute: propose,
    })).toBeNull();
    expect(propose).not.toHaveBeenCalled();
    const resolved = await resolveEvidenceAuthority(f, args);
    expect(resolved.steering).toBe("scheduled-mandate");
  });
  it("refuses a foreign effect without creating another human envelope", async () => {
    const f = state.fixture!; const propose = vi.fn(async () => ({ success: false, error: "authority_denied", message: "The monitor did not run the call or create another request." }));
    const result = await interceptToolCallAsProposal({
      toolDef: tool, proposeSideEffects: true, toolName: tool.name,
      args: { ...f.input.params, capsuleId: "WC-FOREIGN" }, agentId: f.task.agentId,
      threadId: "thread", routeContext: "/ops/workrooms", taskRunId: f.run.taskRunId, execute: propose,
    });
    expect(result).toMatchObject({ success: false, error: "authority_denied" });
    expect(propose).toHaveBeenCalledWith({ proposeBoundary: true, approvalCompletion: "platform", allowApprovalRequest: false });
  });
});


describe("incoming blocked-report and explicit policy preservation", () => {
  it("still records a declared blocked report after completion funding or dispatch expires", async () => {
    const f = state.fixture!;
    f.deps.loadAuthorStageAutonomy.mockResolvedValue(() => ({ roleBindings: {}, withheldBecause: "Funding revoked" }));
    vi.setSystemTime(new Date(SCHEDULED_DELIVERY_NOW.getTime() + 600_001));
    const args = { ...f.input.params, outcome: "blocked" };
    const execute = vi.fn();
    expect(await interceptToolCallAsProposal({ toolDef: tool, proposeSideEffects: true,
      toolName: tool.name, args, agentId: f.task.agentId, threadId: "thread", routeContext: "/ops/workrooms",
      taskRunId: f.run.taskRunId, execute })).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect((await resolveEvidenceAuthority(f, args)).steering).toBe("scheduled-mandate");
    expect(f.deps.loadAuthorStageAutonomy).not.toHaveBeenCalled();
  });
  it("honors current always-review policy through the live loader and actual monitor", async () => {
    const f = state.fixture!; f.agent.governanceProfile = { hitlPolicy: "always" };
    const args = { ...f.input.params };
    const execute = vi.fn(async () => ({ success: false, error: "authority_denied", message: "Explicit always-review is retained; not run." }));
    await interceptToolCallAsProposal({ toolDef: tool, proposeSideEffects: true, toolName: tool.name, args,
      agentId: f.task.agentId, threadId: "thread", routeContext: "/ops/workrooms", taskRunId: f.run.taskRunId, execute });
    expect(execute).toHaveBeenCalledWith({ proposeBoundary: true, approvalCompletion: "platform" });
    const resolved = await resolveEvidenceAuthority(f, args);
    expect(resolved.steering).toBe("none"); expect(resolved.action.approvalPolicy).toBe("all");
  });
});
