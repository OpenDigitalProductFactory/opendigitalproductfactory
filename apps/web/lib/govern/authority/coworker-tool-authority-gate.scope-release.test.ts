import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const live = vi.hoisted(() => ({ room: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: live.room } } }));
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import type { CoworkerAuthorityInput } from "./coworker-authority-decision";
import { enforceCoworkerToolAuthority, setCoworkerToolAuthorityOverridesForTests } from "./coworker-tool-authority-gate";
const epoch = "00000000-0000-4000-8000-000000000001";
const target = { kind: "path", value: "a.ts", intent: "edit", recordedByPrincipalId: "PRN-1", releaseEpoch: epoch };
const request = { capsuleId: "WC-TEST", expectedRoomId: "room-row", claims: [target] };
const tool = { name: "release_workroom_scope", sideEffect: true, executionMode: "immediate" } as unknown as ToolDefinition;
const execution = { toolName: tool.name, rawParams: request, userId: "user-1", context: { agentId: "AGT-OPS" },
  source: "agentic-loop", userContext: { userId: "user-1", isSuperuser: true, platformRole: "HR-000" } } as GovernedExecuteArgs;
function authorityInput(proposeBoundary = false): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "PRN-1", principalAliases: [], population: "workforce", platformRole: "HR-000", isSuperuser: true,
      employeeId: "EMP-1", managerScope: { directReportIds: [], indirectReportIds: [] }, teamIds: [],
      accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      authentication: { source: "session", methods: [], contextClassReference: null },
      actingHumanUserId: "user-1", actingAgentId: "AGT-OPS", delegationGrantIds: [], grantedCapabilities: [],
    },
    action: {
      toolName: "release_workroom_scope", requiredCapability: null, agentGrantAllowed: true, sideEffect: true,
      executionMode: "immediate", routeContext: null, approvalPolicy: "none", consequence: null,
      policyProjectionAllowed: !proposeBoundary,
      ...(proposeBoundary ? { proposeBoundary: true } : {}),
    },
    steering: "scheduled-mandate",
    subject: { kind: "platform", id: "dpf" },
    delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true },
    task: { taskRunId: "TR-SCHED-1" },
    rawParams: request,
  };
}

const ensure = vi.fn(async () => ({ id: "ENV-NEW", status: "proposed", expiresAt: new Date(Date.now() + 60_000) }));
const projection = vi.fn(async () => ({ outcome: "not-authorized" as const }));
const settled = vi.fn(async () => null);
function arrange(input = authorityInput()) {
  setCoworkerToolAuthorityOverridesForTests({ resolveCoworkerAuthorityInput: async () => input,
    authorizationDecisionCreate: async () => ({}), authorityApprovalEnvelopeCreate: ensure,
    policyAuthorityProjectionAttempt: projection, authorityExecutedOutcome: settled });
}
beforeEach(() => { vi.clearAllMocks(); live.room.mockResolvedValue({ id: "room-row", scopeClaims: [{ ...target, recordedAt: new Date().toISOString() }] }); arrange(); });
afterEach(() => setCoworkerToolAuthorityOverridesForTests({ resolveCoworkerAuthorityInput: null,
  authorizationDecisionCreate: null, authorityApprovalEnvelopeCreate: null, policyAuthorityProjectionAttempt: null, authorityExecutedOutcome: null }));
describe("stale scope requests cannot mint replacement approvals", () => {
  it("refuses changed targets before any policy projection or envelope creation", async () => {
    live.room.mockResolvedValue({ id: "room-row", scopeClaims: [] });
    const input = authorityInput(); input.action.approvalPolicy = "all"; input.action.consequence = "authority"; arrange(input);
    expect(await enforceCoworkerToolAuthority(execution, tool, true)).toMatchObject({ outcome: "reject", rejection: "precondition_denied" });
    expect(projection).not.toHaveBeenCalled(); expect(ensure).not.toHaveBeenCalled();
  });
  it("preserves current grant denials before reading any historical result", async () => {
    const input = authorityInput(); input.action.agentGrantAllowed = false; arrange(input);
    expect(await enforceCoworkerToolAuthority(execution, tool, false)).toMatchObject({ outcome: "reject", rejection: "authority_denied", authorityReason: "agent-grant-denied" });
    expect(settled).not.toHaveBeenCalled(); expect(live.room).not.toHaveBeenCalled();
  });
  it("retains the always-human floor for valid targets", async () => {
    const input = authorityInput(); input.action.approvalPolicy = "all"; input.action.consequence = "authority"; arrange(input);
    expect(await enforceCoworkerToolAuthority(execution, tool, true)).toMatchObject({ outcome: "reject", rejection: "approval_required" });
    expect(ensure).toHaveBeenCalledOnce();
  });
});
