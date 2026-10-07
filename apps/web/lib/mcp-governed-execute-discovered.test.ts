// BI-8B7B2FE9: the governed executor resolves a namespaced discovered external
// MCP tool from its DPF-owned policy at call time, intersects it with the
// coworker's grants and External Access, records the authority decision, and
// passes the approved content digest to the remote-call recheck.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tak/mcp-server-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tak/mcp-server-tools")>();
  return { ...actual, resolveDiscoveredToolForCall: vi.fn() };
});

import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { CoworkerAuthorityInput } from "./govern/authority/coworker-authority-decision";
import type { ToolResult } from "./mcp-tool-types";
import { resolveDiscoveredToolForCall } from "./tak/mcp-server-tools";
import { _setDiscoveredDecisionWriterForTests } from "./tak/discovered-tool-governance";

type Row = Record<string, unknown>;
const USER = { platformRole: "ceo", isSuperuser: true };
let authorityRows: Row[];
let refusalRows: Row[];
let executeMock: ReturnType<typeof vi.fn>;
let grants: string[];

function authorityInput(): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "PRN-1", principalAliases: [], population: "workforce", platformRole: "HR-000",
      isSuperuser: true, employeeId: "EMP-1",
      managerScope: { directReportIds: [], indirectReportIds: [] }, teamIds: [],
      accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["public", "internal"],
      authentication: { source: "session", methods: ["mfa"], contextClassReference: null },
      actingHumanUserId: "user-1", actingAgentId: "AGT-100", delegationGrantIds: [],
      grantedCapabilities: ["view_platform"],
    },
    action: {
      toolName: "acme__search", requiredCapability: null, agentGrantAllowed: true, sideEffect: false,
      executionMode: "immediate", routeContext: "/ops", approvalPolicy: "none",
    },
    subject: { kind: "platform", id: "dpf" },
    delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true },
    task: null,
    rawParams: {},
  };
}

const POLICY = {
  namespacedName: "acme__search",
  source: "approved" as const,
  grants: ["registry_read"],
  effect: "read_only" as const,
  modes: ["advise", "act"] as const,
  description: "Search Acme",
  inputSchema: { type: "object" },
  contentDigest: "sha256:approved",
};

function resolvedOk() {
  vi.mocked(resolveDiscoveredToolForCall).mockResolvedValue({
    resolved: true,
    policy: { ...POLICY, modes: [...POLICY.modes] },
    definition: {
      name: "acme__search", description: "Search Acme", inputSchema: { type: "object" },
      requiredCapability: null, requiresExternalAccess: true, sideEffect: false, discoveredPolicyGrants: ["registry_read"],
    },
  });
}

async function call(context: Record<string, unknown> = {}, source: "agentic-loop" | "jsonrpc" = "agentic-loop") {
  return governedExecuteTool({
    toolName: "acme__search",
    rawParams: { q: "x" },
    userId: "user-1",
    userContext: USER,
    context: { agentId: "AGT-100", routeContext: "/ops", externalAccessEnabled: true, ...context },
    source,
  });
}

beforeEach(() => {
  authorityRows = []; refusalRows = []; grants = ["registry_read"];
  vi.mocked(resolveDiscoveredToolForCall).mockReset();
  executeMock = vi.fn(async (): Promise<ToolResult> => ({ success: true, message: "ok" }));
  _setDiscoveredDecisionWriterForTests(async (row) => { refusalRows.push(row); });
  _setGovernanceForTests({
    resolveAgentGrants: async () => grants,
    isAllowedByGrants: () => { throw new Error("platform grant predicate must not decide a discovered tool"); },
    executeTool: executeMock as never,
    toolExecutionCreate: async () => ({ id: "AUD-1" }),
    toolExecutionReceiptCreate: async () => ({ id: "REC-1" }),
    resolveCoworkerAuthorityInput: async () => authorityInput(),
    authorizationDecisionCreate: async (row: Row) => { authorityRows.push(row); },
    authorityApprovalEnvelopeCreate: vi.fn(async () => ({ id: "ENV-1", status: "proposed", expiresAt: null })) as never,
    authorityApprovalTaskResume: vi.fn(async () => undefined),
    authorityApprovalEnvelopeFinalize: vi.fn(async () => undefined),
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async () => true,
    authorityExecutedOutcome: async () => null,
    toolPreflight: async () => null,
  });
});

afterEach(() => {
  _setDiscoveredDecisionWriterForTests(null);
  _setGovernanceForTests({});
});

describe("governedExecuteTool — discovered external MCP tools (AC-MCP-AUTH-003/006)", () => {
  it("executes an approved tool for a coworker holding its grant, carrying the approved digest", async () => {
    resolvedOk();
    const result = await call();
    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledOnce();
    const ctx = executeMock.mock.calls[0]![3] as Record<string, unknown>;
    expect(ctx.discoveredToolAuthorization).toEqual({ namespacedName: "acme__search", contentDigest: "sha256:approved" });
    expect(authorityRows.at(-1)).toMatchObject({ actionKey: "acme__search", decision: "allow" });
  });

  it("denies, with a decision record, when the coworker lacks the policy grant", async () => {
    resolvedOk();
    grants = ["backlog_write"];
    const result = await call();
    expect(result.success).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
    expect(authorityRows.at(-1)).toMatchObject({ actionKey: "acme__search", decision: "deny" });
  });

  it("denies when External Access is not enabled for the turn", async () => {
    resolvedOk();
    const result = await call({ externalAccessEnabled: false });
    expect(result.success).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("refuses a stale-listed tool that is now quarantined and records why", async () => {
    vi.mocked(resolveDiscoveredToolForCall).mockResolvedValue({ resolved: false, reason: "content-changed" });
    const result = await call();
    expect(result.success).toBe(false);
    expect(result.governance?.rejected).toBe("unknown_tool");
    expect(executeMock).not.toHaveBeenCalled();
    expect(refusalRows.at(-1)).toMatchObject({
      actionKey: "acme__search", decision: "deny",
      rationale: expect.objectContaining({ reasonCode: "discovered-tool-content-changed" }),
    });
  });

  it("keeps discovered tools off non-coworker transports (no widening of the external surface)", async () => {
    resolvedOk();
    const result = await call({}, "jsonrpc");
    expect(result.governance?.rejected).toBe("unknown_tool");
    expect(resolveDiscoveredToolForCall).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("refuses a discovered tool with no acting coworker", async () => {
    resolvedOk();
    const result = await governedExecuteTool({
      toolName: "acme__search", rawParams: {}, userId: "user-1", userContext: USER,
      context: { externalAccessEnabled: true }, source: "agentic-loop",
    });
    expect(result.governance?.rejected).toBe("unknown_tool");
    expect(executeMock).not.toHaveBeenCalled();
  });
});
