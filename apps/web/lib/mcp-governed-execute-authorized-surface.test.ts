import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { CoworkerAuthorityInput } from "./govern/authority/coworker-authority-decision";
import type { ToolExecutionContext, ToolResult } from "./mcp-tools";

const USER = { platformRole: "ceo", isSuperuser: true };
type ExecuteTool = (name: string, params: Record<string, unknown>, userId: string, context?: ToolExecutionContext) => Promise<ToolResult>;
let auditRows: Array<Record<string, unknown>>;
let executeTool: ReturnType<typeof vi.fn> & ExecuteTool;

function installOverrides(overrides: Parameters<typeof _setGovernanceForTests>[0] = {}): void {
  _setGovernanceForTests({
    resolveAgentGrants: async () => ["backlog_read", "backlog_write"],
    isAllowedByGrants: () => true,
    executeTool,
    toolExecutionCreate: async (row) => { auditRows.push(row as Record<string, unknown>); },
    resolveCoworkerAuthorityInput: async () => authorityInput(),
    authorizationDecisionCreate: async () => undefined,
    authorityApprovalEnvelopeCreate: async () => ({ id: "ENV-1", status: "proposed", expiresAt: new Date() }),
    authorityApprovalTaskResume: async () => undefined,
    authorityApprovalEnvelopeFinalize: async () => undefined,
    ...overrides,
  });
}

function authorityInput(): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "PRN-1", principalAliases: [], population: "workforce", platformRole: "HR-000",
      isSuperuser: true, employeeId: "EMP-1", managerScope: { directReportIds: [], indirectReportIds: [] },
      teamIds: [], accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      authentication: { source: "session", methods: ["mfa"], contextClassReference: null },
      actingHumanUserId: "user-1", actingAgentId: "AGT-100", delegationGrantIds: [],
      grantedCapabilities: ["view_platform", "view_backlog", "manage_backlog"],
    },
    action: {
      toolName: "surface_open", requiredCapability: "view_platform", agentGrantAllowed: true,
      sideEffect: false, executionMode: "immediate", routeContext: "/platform/tools/discovery", approvalPolicy: "none",
    },
    subject: { kind: "platform", id: "dpf" }, delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true },
    task: null, rawParams: {},
  };
}

beforeEach(() => {
  auditRows = [];
  executeTool = vi.fn(async () => ({ success: true, message: "ok" })) as ReturnType<typeof vi.fn> & ExecuteTool;
  installOverrides();
});

afterEach(() => {
  _setGovernanceForTests({
    resolveAgentGrants: null, isAllowedByGrants: null, executeTool: null, toolExecutionCreate: null,
    resolveCoworkerAuthorityInput: null, authorizationDecisionCreate: null,
    authorityApprovalEnvelopeCreate: null, authorityApprovalTaskResume: null, authorityApprovalEnvelopeFinalize: null,
  });
});

describe("governedExecuteTool — Authorized Surface Contract", () => {
  it("re-governs nested actions, correlates the surface revision, and redacts write-only fields", async () => {
    executeTool = vi.fn(async (name, _params, _userId, context) => {
      if (name !== "surface_act") return { success: true, message: "saved" };
      if (!context?.governedDispatch) throw new Error("missing governed dispatch");
      return context.governedDispatch(
        "configure_and_test_discovery_connection",
        { name: "Gateway", endpointUrl: "10.0.0.1", collectorType: "snmp", apiKey: "private-community" },
        { surfaceId: "platform.estate-discovery", sessionId: "surface-session-1", revision: "rev-1", actionId: "connection.save-and-test" },
      );
    }) as ReturnType<typeof vi.fn> & ExecuteTool;
    installOverrides();

    const result = await governedExecuteTool({
      toolName: "surface_act", rawParams: { sessionId: "surface-session-1", actionId: "connection.save-and-test", expectedRevision: "rev-1" },
      userId: "user-1", userContext: USER, context: { agentId: "AGT-100", threadId: "thread-surface" }, source: "agentic-loop",
    });

    expect(result.success).toBe(true);
    expect(executeTool).toHaveBeenCalledWith("configure_and_test_discovery_connection", expect.objectContaining({ apiKey: "private-community" }), "user-1", expect.any(Object));
    const nested = auditRows.find((row) => row.toolName === "configure_and_test_discovery_connection");
    expect(nested?.parameters).toEqual(expect.objectContaining({
      apiKey: "[REDACTED]",
      _surface: { surfaceId: "platform.estate-discovery", sessionId: "surface-session-1", revision: "rev-1", actionId: "connection.save-and-test" },
    }));
    expect(JSON.stringify(nested)).not.toContain("private-community");
  });

  it("adds only the ASC transport baseline, not unrelated domain writes", async () => {
    installOverrides({
      resolveAgentGrants: async () => ["backlog_read"],
      isAllowedByGrants: (name, grants) => name.startsWith("surface_")
        ? grants.includes("coworker_screen_read") || grants.includes("coworker_screen_drive")
        : false,
    });
    const context = { agentId: "ops-coordinator", coworkerAuthorizedSurfaceBaseline: true };
    const surface = await governedExecuteTool({
      toolName: "surface_open", rawParams: { route: "/platform/tools/discovery" },
      userId: "user-1", userContext: USER, context, source: "agentic-loop",
    });
    expect(surface.success).toBe(true);
    const domainWrite = await governedExecuteTool({
      toolName: "create_backlog_item", rawParams: { title: "x", type: "product", source: "user-request" },
      userId: "user-1", userContext: USER, context, source: "agentic-loop",
    });
    expect(domainWrite).toMatchObject({ success: false, governance: { authorityReason: "agent-grant-denied" } });
  });
});
