// BI-F4EB23C1 — nobody is asked to approve a call the room rule will refuse.
// An OAuth call that targets a Workroom is checked for room admission before
// the authority gate can mint an approval, and again at execution.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoworkerAuthorityInput } from "./govern/authority/coworker-authority-decision";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tool-types";

const room = vi.hoisted(() => ({ refusal: vi.fn() }));
vi.mock("./work-capsules/oauth-workroom-ownership", () => ({ workroomTargetAccessRefusal: room.refusal }));

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
  room.refusal.mockReset().mockResolvedValue(null);
  auditRows = [];
  executeMock = vi.fn(async (): Promise<ToolResult> => ({ success: true, message: "ok" }));
  approvalEnvelopeCreate = vi.fn(async () => ({ id: "ENV-1", status: "proposed", expiresAt: new Date("2026-10-02T03:30:00Z") }));
  _setGovernanceForTests({
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
  } as never);
});

afterEach(() => {
  _setGovernanceForTests({
    resolveAgentGrants: null, isAllowedByGrants: null, executeTool: null, toolExecutionCreate: null,
    toolExecutionReceiptCreate: null, resolveCoworkerAuthorityInput: null, authorizationDecisionCreate: null,
    authorityApprovalEnvelopeCreate: null, authorityApprovalTaskResume: null, authorityApprovalEnvelopeFinalize: null,
    policyAuthorityProjectionAttempt: null, policyAuthorityEnvelopeReserve: null, authorityExecutedOutcome: null,
  });
});

describe("governedExecuteTool — room access before approval", () => {
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
