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
vi.mock("@/lib/identity/load-effective-auth-context", () => ({
  loadEffectiveAuthContext: async () => ({ actingHumanUserId: "owner",
    actingAgentId: coworkerAuthorityAgentId(state.fixture!.task.agentId) }),
}));
vi.mock("@/lib/coworker/authority-approval-envelope", () => ({ findApprovedAuthorityEnvelope: async () => null }));
import { interceptToolCallAsProposal } from "@/lib/proactivity/propose-interception";
import { resolveCoworkerToolAuthorityInput } from "@/lib/govern/authority/resolve-coworker-tool-authority";
import { toRoomAuthorityContext } from "./room-turn-authority";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SCHEDULED_DELIVERY_NOW); state.fixture = scheduledDeliveryFixture(); });
afterEach(() => { vi.useRealTimers(); });
const tool = { name: "record_workroom_evidence", description: "Record stage evidence", inputSchema: {},
  requiredCapability: null, sideEffect: true, executionMode: "immediate" as const };

async function resolveEvidenceAuthority(f: ReturnType<typeof scheduledDeliveryFixture>, args: Record<string, unknown>) {
  const db = { ...f.db, agent: { findFirst: async () => ({ id: "agent-row",
      agentId: coworkerAuthorityAgentId(f.task.agentId), sensitivity: "internal", hitlTierDefault: 2, governanceProfile: f.agent.governanceProfile ? { ...f.agent.governanceProfile, updatedAt: SCHEDULED_DELIVERY_NOW } : null }) } };
  return resolveCoworkerToolAuthorityInput({
      execution: { source: "agentic-loop", toolName: tool.name, rawParams: args, userId: "owner",
        userContext: { platformRole: "admin", isSuperuser: true },
        context: { agentId: f.task.agentId, taskRunId: f.run.taskRunId, routeContext: "/ops/workrooms",
          roomAuthority: toRoomAuthorityContext({ ...f.roomTurn, actionBoundary: "propose" }) ?? undefined } },
      tool, agentGrantAllowed: true,
    }, db as never);
}

describe("scheduled delivery proposal and reference-monitor flow", () => {
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
