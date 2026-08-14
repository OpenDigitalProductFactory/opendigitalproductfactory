import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tools";

const USER = { platformRole: "ceo", isSuperuser: true };
const resolveActor = async (args: { context?: { agentId?: string }; userId: string }) => ({
  principalId: args.context?.agentId ? "PRN-COWORKER" : "PRN-HUMAN",
  gaid: args.context?.agentId ? "GAID-COWORKER" : "GAID-HUMAN",
  actorKind: (args.context?.agentId ? "coworker" : args.userId === "employee-1" ? "employee" : "owner") as
    "coworker" | "employee" | "owner",
  actorRef: args.context?.agentId ?? args.userId,
});
const alignmentDecision = (verdict: "approve" | "decline" | "escalate") => ({
  verdict,
  interactionId: `DI-${verdict}`,
  rationale: `${verdict} from WWWD`,
  policyVersion: "wwwd:v1",
  amendmentLineage: ["wiki:stance:v1"],
  alignment: {
    verdict,
    criteria: {
      status: "complete" as const,
      criteria: {
        market: "consumer physical retail", segment: "consumer physical retail",
        product: "toasters", motion: "kiosk retail", geography: "alaska",
        customerType: "fishermen",
      },
      evidence: ["product=toasters"],
      missing: [],
    },
    checks: verdict === "decline" ? [{
      corpus: "wwwd" as const, criterion: "market" as const,
      verdict: "rejected" as const, rationale: "explicit boundary",
      evidenceRefs: ["wiki:stance"],
    }] : [],
    veto: verdict === "decline" ? {
      corpus: "wwwd" as const, criterion: "market" as const,
      verdict: "rejected" as const, rationale: "explicit boundary",
      evidenceRefs: ["wiki:stance"],
    } : null,
  },
});

function authorityInput() {
  return {
    authContext: {
      principalId: "PRN-1", principalAliases: [], population: "workforce",
      platformRole: "HR-000", isSuperuser: true, employeeId: "EMP-1",
      managerScope: { directReportIds: [], indirectReportIds: [] }, teamIds: [],
      accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      authentication: { source: "session", methods: ["mfa"], contextClassReference: null },
      actingHumanUserId: "user-1", actingAgentId: "AGT-100",
      delegationGrantIds: [], grantedCapabilities: ["manage_platform"],
    },
    action: {
      toolName: "create_digital_product", requiredCapability: "manage_platform",
      agentGrantAllowed: true, sideEffect: true, executionMode: "immediate",
      routeContext: "/portfolio", approvalPolicy: "none",
    },
    subject: { kind: "platform", id: "dpf" }, delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: {
      sensitivity: "internal", maskingRequired: false, maskingSatisfied: true,
      decisionVersionsCurrent: true,
    },
    task: null, rawParams: {},
  };
}

describe("TAK alignment interception", () => {
  type ExecuteFn = (name: string, params: Record<string, unknown>, userId: string) => Promise<ToolResult>;
  let execute: ReturnType<typeof vi.fn> & ExecuteFn;
  let audits: Record<string, unknown>[];
  let receipts: Record<string, unknown>[];
  let receiptUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  let auditUpdates: Array<{ id: string; data: Record<string, unknown> }>;

  beforeEach(() => {
    execute = vi.fn(async (): Promise<ToolResult> => ({ success: true, message: "ok" })) as
      ReturnType<typeof vi.fn> & ExecuteFn;
    audits = [];
    receipts = [];
    receiptUpdates = [];
    auditUpdates = [];
    _setGovernanceForTests({
      executeTool: execute,
      resolveAgentGrants: async () => ["portfolio_write"],
      isAllowedByGrants: () => true,
      resolveCoworkerAuthorityInput: async () => authorityInput() as never,
      authorizationDecisionCreate: async () => ({}),
      toolExecutionCreate: async (data) => { audits.push(data); return { id: "tool-exec" }; },
      toolExecutionUpdate: async (id, data) => { auditUpdates.push({ id, data }); },
      toolExecutionReceiptCreate: async (data) => { receipts.push(data); return { id: "receipt-1" }; },
      toolExecutionReceiptUpdate: async (id, data) => { receiptUpdates.push({ id, data }); },
      gaidActorResolver: resolveActor,
    });
  });

  afterEach(() => _setGovernanceForTests({}));

  it("skips alignment for routine reads", async () => {
    const alignmentGate = vi.fn(async () => alignmentDecision("approve"));
    _setGovernanceForTests({
      alignmentGate, executeTool: execute,
      toolExecutionCreate: async (data) => { audits.push(data); return { id: "read" }; },
    });
    await governedExecuteTool({
      toolName: "query_backlog", rawParams: {}, userId: "user-1",
      userContext: USER, source: "rest",
    });
    expect(alignmentGate).not.toHaveBeenCalled();
  });

  it.each([
    ["owner", "user-1", undefined],
    ["employee", "employee-1", undefined],
    ["coworker", "user-1", { agentId: "AGT-100", threadId: "thread-1" }],
  ])("blocks a rejected call before mutation for %s", async (label, userId, context) => {
    _setGovernanceForTests({
      alignmentGate: async () => alignmentDecision("decline"), executeTool: execute,
      resolveAgentGrants: async () => ["portfolio_write"], isAllowedByGrants: () => true,
      resolveCoworkerAuthorityInput: async () => authorityInput() as never,
      authorizationDecisionCreate: async () => ({}),
      toolExecutionCreate: async (data) => { audits.push(data); return { id: "deny" }; },
      toolExecutionReceiptCreate: async (data) => { receipts.push(data); return { id: "deny-receipt" }; },
      gaidActorResolver: resolveActor,
    });
    const result = await governedExecuteTool({
      toolName: "create_digital_product",
      rawParams: { name: "Toasters", description: "Sell to Alaskan fishermen" },
      userId, userContext: USER, context,
      source: context ? "agentic-loop" : "rest",
    });
    expect(result.error).toBe("alignment_denied");
    expect(execute).not.toHaveBeenCalled();
    expect(receipts).toEqual([expect.objectContaining({
      toolExecutionId: "deny", receiptKind: "tak-consequential-action",
      executionStatus: "failed",
    })]);
    expect(receipts[0]?.outputDigest).toEqual(expect.objectContaining({
      governance: expect.objectContaining({
        actor: expect.objectContaining({ actorKind: label }),
        gateDecision: "decline", policyVersion: "wwwd:v1",
        amendmentLineage: ["wiki:stance:v1"], evidenceRefs: ["wiki:stance"],
      }),
    }));
  });

  it("executes approval and receipts it", async () => {
    _setGovernanceForTests({
      alignmentGate: async () => alignmentDecision("approve"), executeTool: execute,
      toolExecutionCreate: async (data) => { audits.push(data); return { id: "allow" }; },
      toolExecutionReceiptCreate: async (data) => { receipts.push(data); return { id: "allow-receipt" }; },
      toolExecutionUpdate: async (id, data) => { auditUpdates.push({ id, data }); },
      toolExecutionReceiptUpdate: async (id, data) => { receiptUpdates.push({ id, data }); },
      gaidActorResolver: resolveActor,
    });
    const result = await governedExecuteTool({
      toolName: "create_digital_product", rawParams: { name: "Self-host support subscription" },
      userId: "user-1", userContext: USER, source: "rest",
    });
    expect(result.success).toBe(true);
    expect(receipts).toEqual([expect.objectContaining({
      toolExecutionId: "allow", receiptKind: "tak-consequential-action",
      executionStatus: "reserved", receiptStatus: "reserved",
    })]);
    expect(receipts[0]?.outputDigest).toEqual(expect.objectContaining({
      governance: expect.objectContaining({
        actor: expect.objectContaining({ gaid: "GAID-HUMAN", actorKind: "owner" }),
        gateDecision: "approve", policyVersion: "wwwd:v1",
      }),
    }));
    expect(receiptUpdates).toEqual([expect.objectContaining({
      id: "allow-receipt",
      data: expect.objectContaining({ executionStatus: "succeeded", receiptStatus: "valid" }),
    })]);
    expect(execute.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  it("blocks an unmet ordering prerequisite before a consequential workforce mutation", async () => {
    _setGovernanceForTests({
      preconditionGate: async () => ({
        verdict: "decline", rationale: "Employee identity must exist before the transition.",
        checks: [{
          key: "employee-identity", coherent: true, satisfied: false,
          evidenceRefs: ["ea:value-stream:onboarding:identity", "prisma:model:EmployeeProfile#employeeId"],
        }],
      }),
      executeTool: execute,
      toolExecutionCreate: async (data) => { audits.push(data); return { id: "precondition-deny" }; },
      toolExecutionReceiptCreate: async (data) => { receipts.push(data); return { id: "precondition-receipt" }; },
      gaidActorResolver: resolveActor,
    });
    const result = await governedExecuteTool({
      toolName: "transition_employee_status",
      rawParams: { employeeId: "EMP-MISSING", status: "active" },
      userId: "user-1", userContext: USER, source: "rest",
    });
    expect(result.error).toBe("precondition_denied");
    expect(execute).not.toHaveBeenCalled();
    expect(receipts).toEqual([expect.objectContaining({ toolExecutionId: "precondition-deny" })]);
  });

  it("rejects bypass arguments and directs the caller to a versioned stance amendment", async () => {
    const result = await governedExecuteTool({
      toolName: "create_digital_product",
      rawParams: { name: "Toasters", alignmentOverride: true },
      userId: "user-1", userContext: USER, source: "rest",
    });
    expect(result.error).toBe("alignment_bypass_forbidden");
    expect(result.message).toContain("Amend the versioned WWWD stance");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed before mutation when the mandatory GAID receipt cannot be reserved", async () => {
    _setGovernanceForTests({
      alignmentGate: async () => alignmentDecision("approve"), executeTool: execute,
      toolExecutionCreate: async (data) => { audits.push(data); return { id: "reservation-failure" }; },
      toolExecutionUpdate: async (id, data) => { auditUpdates.push({ id, data }); },
      toolExecutionReceiptCreate: async () => { throw new Error("ledger unavailable"); },
      gaidActorResolver: async () => ({
        principalId: "PRN-HUMAN", gaid: "GAID-HUMAN", actorKind: "owner", actorRef: "user-1",
      }),
    });
    const result = await governedExecuteTool({
      toolName: "create_digital_product", rawParams: { name: "Self-host support" },
      userId: "user-1", userContext: USER, source: "rest",
    });
    expect(result.error).toBe("receipt_reservation_failed");
    expect(execute).not.toHaveBeenCalled();
  });
});
