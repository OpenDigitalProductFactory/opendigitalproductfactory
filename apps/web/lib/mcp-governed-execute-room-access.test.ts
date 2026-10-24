// BI-F4EB23C1 — nobody is asked to approve a call the room rule will refuse.
// Ordinary OAuth Workroom calls retain admission checks before approval and
// execution. Classification recovery checks current administrator authority;
// its correction still requires the exact authority approval.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoworkerAuthorityInput } from "./govern/authority/coworker-authority-decision";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tool-types";

const room = vi.hoisted(() => ({ refusal: vi.fn() }));
vi.mock("./work-capsules/oauth-workroom-ownership", () => ({ workroomTargetAccessRefusal: room.refusal }));

const recoveryGuard = vi.hoisted(() => vi.fn());
vi.mock("./mcp-task-review-recovery", () => ({ reviewRecoveryToolRefusal: recoveryGuard }));
const NORMAL_USER = { platformRole: "ceo", isSuperuser: true };
type AuditRow = Record<string, unknown>;
let auditRows: AuditRow[];
let executeMock: ReturnType<typeof vi.fn>;
let approvalEnvelopeCreate: ReturnType<typeof vi.fn>;

function authorityInput(
  overrides: Partial<CoworkerAuthorityInput> = {},
): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "PRN-1",
      principalAliases: [],
      population: "workforce",
      platformRole: "HR-000",
      isSuperuser: true,
      employeeId: "EMP-1",
      managerScope: { directReportIds: [], indirectReportIds: [] },
      teamIds: [],
      accountScope: {
        accountIds: [],
        contactIds: [],
        partnerAccountIds: [],
      },
      sensitivityClearance: [
        "public",
        "internal",
        "confidential",
        "restricted",
      ],
      authentication: {
        source: "session",
        methods: ["mfa"],
        contextClassReference: null,
      },
      actingHumanUserId: "user-1",
      actingAgentId: "AGT-100",
      delegationGrantIds: [],
      grantedCapabilities: ["view_platform", "view_backlog", "manage_backlog"],
    },
    action: {
      toolName: "query_backlog",
      requiredCapability: "view_platform",
      agentGrantAllowed: true,
      sideEffect: false,
      executionMode: "immediate",
      routeContext: "/ops",
      approvalPolicy: "none",
    },
    subject: { kind: "platform", id: "dpf" },
    delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: {
      sensitivity: "internal",
      maskingRequired: false,
      maskingSatisfied: true,
      decisionVersionsCurrent: true,
    },
    task: null,
    rawParams: {},
    ...overrides,
  };
}
const handover = {
  toolName: "reassign_workroom_executor",
  rawParams: { capsuleId: "WC-D72FAD2A", toExecutorKind: "codex-desktop", reason: "take over" },
  userId: "admin-user",
  userContext: NORMAL_USER,
  context: { agentId: "AGT-EXT-CODEX", authSource: "oauth" as const, apiTokenId: "tok-1" },
  source: "external-jsonrpc" as const,
};

beforeEach(() => {
  recoveryGuard.mockResolvedValue(null);
  room.refusal.mockReset().mockResolvedValue(null);
  auditRows = [];
  executeMock = vi.fn(async (): Promise<ToolResult> => ({ success: true, message: "ok" }));
  approvalEnvelopeCreate = vi.fn(async () => ({ id: "ENV-1", status: "proposed", expiresAt: new Date(Date.now() + 15 * 60_000) }));
  _setGovernanceForTests(baseGovernance() as never);
});

function baseGovernance() {
  return {
    resolveAgentGrants: async () => ["backlog_read", "backlog_write"],
    isAllowedByGrants: () => true,
    executeTool: executeMock as never,
    toolExecutionCreate: async (data: AuditRow) => { auditRows.push(data); },
    toolExecutionReceiptCreate: async () => undefined,
    resolveCoworkerAuthorityInput: async () => authorityInput({
      action: { ...authorityInput().action, toolName: "reassign_workroom_executor", sideEffect: true, approvalPolicy: "side-effects" },
      rawParams: handover.rawParams,
    }),
    authorizationDecisionCreate: async () => undefined,
    authorityApprovalEnvelopeCreate: approvalEnvelopeCreate as never,
    authorityApprovalTaskResume: async () => undefined,
    authorityApprovalEnvelopeFinalize: async () => undefined,
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async () => true,
    authorityExecutedOutcome: async () => null,
  };
}

afterEach(() => {
  _setGovernanceForTests({
    resolveAgentGrants: null, isAllowedByGrants: null, executeTool: null, toolExecutionCreate: null,
    toolExecutionReceiptCreate: null, resolveCoworkerAuthorityInput: null, authorizationDecisionCreate: null,
    authorityApprovalEnvelopeCreate: null, authorityApprovalTaskResume: null, authorityApprovalEnvelopeFinalize: null,
    policyAuthorityProjectionAttempt: null, policyAuthorityEnvelopeReserve: null, authorityExecutedOutcome: null,
  });
});

describe("governedExecuteTool — room access before approval", () => {
  it("refuses revoked recovered-task authority before a writer or approval is attempted", async () => {
    recoveryGuard.mockResolvedValue({ success: false, error: "review_execution_authority_refused", message: "Current review authority was revoked." });
    const result = await governedExecuteTool({ toolName: "query_backlog", rawParams: {}, userId: "user-1", userContext: NORMAL_USER,
      source: "agentic-loop", context: { taskRunId: "TR-RECOVERED", apiTokenId: "current-token", agentId: "AGT-REVIEWER" } });
    expect(result).toMatchObject({ success: false, error: "review_execution_authority_refused" });
    expect(executeMock).not.toHaveBeenCalled(); expect(approvalEnvelopeCreate).not.toHaveBeenCalled();
  });
  it("runs the masked classification read without creating an approval", async () => {
    const toolName = "review_workroom_sensitivity";
    const rawParams = { capsuleId: "WC-D72FAD2A" };
    _setGovernanceForTests({
      ...baseGovernance(),
      resolveCoworkerAuthorityInput: async () => authorityInput({
        authContext: { ...authorityInput().authContext, grantedCapabilities: ["manage_platform"] },
        action: { ...authorityInput().action, toolName, requiredCapability: "manage_platform" },
        rawParams,
      }),
    } as never);
    expect(await governedExecuteTool({ ...handover, toolName, rawParams })).toMatchObject({ success: true });
    expect(approvalEnvelopeCreate).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledOnce();
    expect(room.refusal).toHaveBeenCalledWith(expect.objectContaining({ toolName, action: false }));
  });

  it("still requires exact approval before executing classification correction", async () => {
    const toolName = "correct_workroom_sensitivity";
    const rawParams = { capsuleId: "WC-D72FAD2A", expectedDigest: "1".repeat(64),
      sensitivity: "internal", classificationReviewed: true,
      rationale: "The administrator reviewed this synthetic classification fixture." };
    _setGovernanceForTests({
      ...baseGovernance(),
      resolveCoworkerAuthorityInput: async () => authorityInput({
        authContext: { ...authorityInput().authContext, grantedCapabilities: ["manage_platform"] },
        action: { ...authorityInput().action, toolName, requiredCapability: "manage_platform",
          sideEffect: true, executionMode: "proposal", approvalPolicy: "side-effects", consequence: "authority" },
        rawParams,
      }),
    } as never);
    expect(await governedExecuteTool({ ...handover, toolName, rawParams })).toMatchObject({ error: "approval_required" });
    expect(approvalEnvelopeCreate).toHaveBeenCalledWith(expect.objectContaining({ consequence: "authority" }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns the room refusal, audits it, and mints no approval", async () => {
    room.refusal.mockResolvedValue({ success: false, error: "workroom_handover_not_owner", message: "not the owner" });
    const result = await governedExecuteTool(handover);
    expect(result).toMatchObject({ success: false, error: "workroom_handover_not_owner" });
    expect(approvalEnvelopeCreate).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
    expect(auditRows.at(-1)).toMatchObject({ toolName: "reassign_workroom_executor" });
    expect(room.refusal).toHaveBeenCalledWith(expect.objectContaining({ toolName: "reassign_workroom_executor", userId: "admin-user", agentId: "AGT-EXT-CODEX", authSource: "oauth", action: true }));
  });

  it("still asks for approval when the room admits the call", async () => {
    const result = await governedExecuteTool(handover);
    expect(result).toMatchObject({ success: false, error: "approval_required" });
    expect(approvalEnvelopeCreate).toHaveBeenCalledOnce();
  });

  // BI-0012E6CA: the call's resolved consequence travels to the envelope writer,
  // which sizes the request's lifetime from it; it never joins the binding.
  it("hands the call's resolved consequence to the envelope writer", async () => {
    _setGovernanceForTests({
      ...baseGovernance(),
      resolveCoworkerAuthorityInput: async () => authorityInput({
        action: {
          ...authorityInput().action,
          toolName: "reassign_workroom_executor",
          sideEffect: true,
          approvalPolicy: "side-effects",
          consequence: "irreversible",
        },
        rawParams: handover.rawParams,
      }),
    } as never);
    await governedExecuteTool(handover);
    expect(approvalEnvelopeCreate).toHaveBeenCalledWith(expect.objectContaining({ consequence: "irreversible" }));
    const binding = (approvalEnvelopeCreate.mock.calls[0]![0] as { binding: Record<string, unknown> }).binding;
    expect(binding).not.toHaveProperty("consequence");
  });

  it("lets an approved run reach the gate, so its refusal closes the approval as failed", async () => {
    room.refusal.mockResolvedValue({ success: false, error: "workroom_access_denied", message: "no" });
    const result = await governedExecuteTool({ ...handover, context: { ...handover.context, callerClient: "approval-completion" } });
    // The authority gate ran (here it asks again, as no approval is stubbed);
    // the room check then refuses inside the executor, after the gate.
    expect(result).toMatchObject({ error: "approval_required" });
    expect(room.refusal).not.toHaveBeenCalled();
  });

  it("leaves non-OAuth calls to their existing policy", async () => {
    room.refusal.mockResolvedValue({ success: false, error: "workroom_access_denied", message: "no" });
    const result = await governedExecuteTool({ ...handover, context: { agentId: "AGT-EXT-CODEX" } });
    expect(result).toMatchObject({ error: "approval_required" });
    expect(room.refusal).not.toHaveBeenCalled();
  });
});
