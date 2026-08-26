import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _setGovernanceForTests,
  agentHasAnyGrant,
  governedExecuteTool,
  registerToolLifecycleHook,
} from "./mcp-governed-execute";
import type {
  AuthorityApprovalEnvelopeCreate,
  AuthorityApprovalEnvelopeFinalize,
  AuthorityApprovalTaskResume,
} from "./mcp-governed-execute";
import type { CoworkerAuthorityInput } from "./govern/authority/coworker-authority-decision";
import type { ToolResult } from "./mcp-tools";
import { registerCoworkerAuthorityCases } from "./mcp-governed-execute-authority.cases";
type AuditRow = Record<string, unknown>;
function captureAudit(rows: AuditRow[]) { return async (data: AuditRow) => { rows.push(data); }; }
const NORMAL_USER = { platformRole: "ceo", isSuperuser: true };
type ExecuteFn = (
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  ctx?: {
    agentId?: string;
    threadId?: string;
    routeContext?: string;
    taskRunId?: string;
  },
) => Promise<ToolResult>;
let auditRows: AuditRow[];
let receiptRows: AuditRow[];
let authorityRows: AuditRow[];
let executeMock: ReturnType<typeof vi.fn> & ExecuteFn;
let approvalEnvelopeCreate: AuthorityApprovalEnvelopeCreate;
let approvalTaskResume: AuthorityApprovalTaskResume;
let approvalEnvelopeFinalize: AuthorityApprovalEnvelopeFinalize;
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
function applyAuthorityOverrides(
  overrides: Parameters<typeof _setGovernanceForTests>[0],
): void {
  _setGovernanceForTests({
    resolveAgentGrants: async () => ["backlog_read", "backlog_write"],
    isAllowedByGrants: () => true,
    executeTool: executeMock,
    toolExecutionCreate: captureAudit(auditRows),
    toolExecutionReceiptCreate: captureAudit(receiptRows),
    resolveCoworkerAuthorityInput: async () => authorityInput(),
    authorizationDecisionCreate: captureAudit(authorityRows),
    authorityApprovalEnvelopeCreate: approvalEnvelopeCreate,
    authorityApprovalTaskResume: approvalTaskResume,
    authorityApprovalEnvelopeFinalize: approvalEnvelopeFinalize,
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async () => true,
    ...overrides,
  });
}

beforeEach(() => {
  auditRows = [];
  receiptRows = [];
  authorityRows = [];
  executeMock = vi.fn(
    async (): Promise<ToolResult> => ({
      success: true,
      message: "ok",
      entityId: "BI-FAKE",
    }),
  ) as ReturnType<typeof vi.fn> & ExecuteFn;
  approvalEnvelopeCreate = vi.fn(async () => ({
    id: "ENV-1",
    status: "proposed",
    expiresAt: new Date("2026-07-27T12:00:00Z"),
  }));
  approvalTaskResume = vi.fn(async () => undefined);
  approvalEnvelopeFinalize = vi.fn(async () => undefined);
  _setGovernanceForTests({
    resolveAgentGrants: async () => ["backlog_read", "backlog_write"],
    isAllowedByGrants: () => true,
    executeTool: executeMock,
    toolExecutionCreate: captureAudit(auditRows),
    toolExecutionReceiptCreate: captureAudit(receiptRows),
    resolveCoworkerAuthorityInput: async () => authorityInput(),
    authorizationDecisionCreate: captureAudit(authorityRows),
    authorityApprovalEnvelopeCreate: approvalEnvelopeCreate,
    authorityApprovalTaskResume: approvalTaskResume,
    authorityApprovalEnvelopeFinalize: approvalEnvelopeFinalize,
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async () => true,
  });
});

afterEach(() => {
  _setGovernanceForTests({
    resolveAgentGrants: null,
    isAllowedByGrants: null,
    executeTool: null,
    toolExecutionCreate: null,
    toolExecutionReceiptCreate: null,
    resolveCoworkerAuthorityInput: null,
    authorizationDecisionCreate: null,
    authorityApprovalEnvelopeCreate: null,
    authorityApprovalTaskResume: null,
    authorityApprovalEnvelopeFinalize: null,
    policyAuthorityProjectionAttempt: null,
    policyAuthorityEnvelopeReserve: null,
  });
});

describe("governedExecuteTool — happy path", () => {
  registerCoworkerAuthorityCases({
    applyOverrides: applyAuthorityOverrides, authorityInput,
    normalUser: NORMAL_USER, executeMock: () => executeMock,
    authorityRows: () => authorityRows, auditRows: () => auditRows,
    approvalEnvelopeCreate: () => approvalEnvelopeCreate, approvalTaskResume: () => approvalTaskResume,
    approvalEnvelopeFinalize: () => approvalEnvelopeFinalize,
  });
  it("supports registering and unregistering lifecycle hooks", async () => {
    const calls: string[] = [];
    const unregister = registerToolLifecycleHook({
      id: "registered-test-hook",
      onPreToolUse: async (event) => {
        calls.push(event.toolName);
      },
    });

    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "user-1",
      userContext: NORMAL_USER,
      source: "rest",
    });

    unregister();

    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "user-1",
      userContext: NORMAL_USER,
      source: "rest",
    });

    expect(calls).toEqual(["query_backlog"]);
  });

  it("stamps the chain-of-custody link (delegationChainId) from context onto the audit row (BI-F82F4E04)", async () => {
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { agentId: "AGT-100", threadId: "thread-1", delegationChainId: "chain-xyz" },
      source: "agentic-loop",
    });
    expect((auditRows.at(-1) as { delegationChainId?: string })?.delegationChainId).toBe("chain-xyz");

    // A direct human→coworker call carries no chain — null, but the human is on userId.
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "user-1",
      userContext: NORMAL_USER,
      source: "rest",
    });
    const direct = auditRows.at(-1) as { delegationChainId?: string | null; userId?: string };
    expect(direct?.delegationChainId ?? null).toBeNull();
    expect(direct?.userId).toBe("user-1");
  });

  it("runs lifecycle hooks around successful tool execution", async () => {
    const calls: string[] = [];
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["backlog_read"],
      isAllowedByGrants: () => true,
      executeTool: executeMock,
      toolExecutionCreate: captureAudit(auditRows),
      lifecycleHooks: [
        {
          id: "test-hook",
          onPreToolUse: async (event) => {
            calls.push(`pre:${event.toolName}:${event.source}`);
          },
          onPostToolUse: async (event) => {
            calls.push(`post:${event.toolName}:${event.result.success}`);
          },
        },
      ],
    });

    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { status: "open" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { agentId: "AGT-100", threadId: "thread-1" },
      source: "agentic-loop",
    });

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      "pre:query_backlog:agentic-loop",
      "post:query_backlog:true",
    ]);
  });

  it("lets a pre-tool hook deny execution before executeTool is invoked", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["sandbox_execute"],
      isAllowedByGrants: () => true,
      executeTool: executeMock,
      toolExecutionCreate: captureAudit(auditRows),
      lifecycleHooks: [
        {
          id: "block-dangerous-command",
          onPreToolUse: async () => ({
            decision: "deny",
            reason: "Sandbox command requires review",
          }),
        },
      ],
    });

    const result = await governedExecuteTool({
      toolName: "run_sandbox_command",
      rawParams: { command: "pnpm build" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { agentId: "AGT-300", threadId: "thread-1" },
      source: "agentic-loop",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("hook_denied");
    expect(result.message).toContain("Sandbox command requires review");
    expect(executeMock).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.success).toBe(false);
    expect(auditRows[0]?.toolName).toBe("run_sandbox_command");
  });

  it("invokes executeTool, audits with the correct executionMode, and returns the result", async () => {
    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { status: "open" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { agentId: "AGT-100", threadId: "thread-1" },
      source: "rest",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("ok");
    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock).toHaveBeenCalledWith(
      "query_backlog",
      { status: "open" },
      "user-1",
      expect.objectContaining({ agentId: "AGT-100", threadId: "thread-1" }),
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.toolName).toBe("query_backlog");
    expect(auditRows[0]!.executionMode).toBe("rest");
    expect(auditRows[0]!.success).toBe(true);
    expect(auditRows[0]!.userId).toBe("user-1");
    expect(auditRows[0]!.agentId).toBe("AGT-100");
  });

  it("forwards caller attribution and effective token scope into executeTool (BI-0EEBA669)", async () => {
    // Regression: governedExecuteTool built the executeTool context from only
    // {agentId, threadId, routeContext, taskRunId, featureBuildId} and dropped
    // the three caller-attribution fields, so every principle_decide consult
    // recorded an all-null caller and the decision ledger could not match a
    // decision back to the client/thread that made it.
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { status: "open" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: {
        agentId: "AGT-100",
        threadId: "thread-9",
        callerClient: "claude-code/2.1",
        apiTokenId: "tok_xyz",
        authSource: "pat",
        tokenScope: "admin",
      },
      source: "external-jsonrpc",
    });

    expect(executeMock).toHaveBeenCalledWith(
      "query_backlog",
      { status: "open" },
      "user-1",
      expect.objectContaining({
        callerClient: "claude-code/2.1",
        apiTokenId: "tok_xyz",
        authSource: "pat",
        tokenScope: "admin",
        threadId: "thread-9",
      }),
    );
  });

  it("propagates the source field unchanged for each transport", async () => {
    for (const source of ["rest", "jsonrpc", "external-jsonrpc", "agentic-loop"] as const) {
      auditRows.length = 0;
      await governedExecuteTool({
        toolName: "query_backlog",
        rawParams: {},
        userId: "u",
        userContext: NORMAL_USER,
        source,
      });
      expect(auditRows[0]?.executionMode).toBe(source);
    }
  });

  it("writes apiTokenId from context when set (external-jsonrpc transport)", async () => {
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      context: { apiTokenId: "tok_abc" },
      source: "external-jsonrpc",
    });
    expect(auditRows[0]?.apiTokenId).toBe("tok_abc");
  });

  it("writes apiTokenId=null when context has no token (in-portal transports)", async () => {
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "agentic-loop",
    });
    expect(auditRows[0]?.apiTokenId).toBeNull();
  });

  it("mints a provenance receipt for verification tools when the tool result includes buildId", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["build_write"],
      isAllowedByGrants: () => true,
      executeTool: vi.fn(
        async (): Promise<ToolResult> => ({
          success: true,
          message: "tests passed",
          data: {
            buildId: "FB-200",
            testsPassed: 4,
            testsFailed: 0,
          },
        }),
      ) as ReturnType<typeof vi.fn> & ExecuteFn,
      toolExecutionCreate: async (data: AuditRow) => {
        auditRows.push(data);
        return { id: "tool-exec-1" };
      },
      toolExecutionReceiptCreate: captureAudit(receiptRows),
    });

    await governedExecuteTool({
      toolName: "run_sandbox_tests",
      rawParams: { auto_fix: false },
      userId: "user-1",
      userContext: NORMAL_USER,
      source: "agentic-loop",
    });

    expect(receiptRows).toHaveLength(1);
    expect(receiptRows[0]).toEqual(
      expect.objectContaining({
        buildId: "FB-200",
        executionStatus: "succeeded",
        receiptKind: "sandbox-test-run",
        receiptStatus: "valid",
        toolExecutionId: "tool-exec-1",
      }),
    );
  });
});

describe("governedExecuteTool — rejection paths", () => {
  it("returns unknown_tool without invoking executeTool", async () => {
    const result = await governedExecuteTool({
      toolName: "totally_made_up_tool",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "rest",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("unknown_tool");
    expect(executeMock).not.toHaveBeenCalled();
    // unknown_tool is rejected before audit write
    expect(auditRows).toHaveLength(0);
  });

  it("rejects on forbidden_capability and audits the failure", async () => {
    const lowPrivilege = { platformRole: "viewer", isSuperuser: false };
    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "x", type: "product", source: "user-request" },
      userId: "u",
      userContext: lowPrivilege,
      source: "rest",
    });
    // viewer doesn't have manage_backlog
    expect(result.success).toBe(false);
    expect(result.error).toBe("forbidden_capability");
    expect(executeMock).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.success).toBe(false);
  });
});

describe("governedExecuteTool — resilience", () => {
  it("does not throw to the caller when audit write fails", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["backlog_read"],
      isAllowedByGrants: () => true,
      executeTool: executeMock,
      toolExecutionCreate: async () => {
        throw new Error("DB exploded");
      },
    });
    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "rest",
    });
    // Tool ran successfully even though audit write failed
    expect(result.success).toBe(true);
  });

  it("converts a thrown executeTool into a structured failure result + audit", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["backlog_read"],
      isAllowedByGrants: () => true,
      executeTool: async () => {
        throw new Error("kaboom");
      },
      toolExecutionCreate: captureAudit(auditRows),
    });
    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "u",
      userContext: NORMAL_USER,
      source: "rest",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool_threw");
    expect(result.message).toContain("kaboom");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.success).toBe(false);
  });
});

// BI-16A80690: some MCP clients serialize array/object tool args as JSON
// strings on the wire. governedExecuteTool is the single funnel for all MCP
// wire transports, so it re-hydrates those strings (schema-driven) before the
// tool switch sees them. These tests use the REAL principle_decide schema from
// PLATFORM_TOOLS (resolved by findTool) and assert via the executeTool spy that
// the handler receives native values — locking BOTH the JSON-string and the
// already-structured shapes.
describe("governedExecuteTool — JSON-string arg coercion (BI-16A80690)", () => {
  const STRUCTURED_OPTIONS = [
    { id: "a", description: "Option A" },
    { id: "b", description: "Option B" },
  ];

  it("re-hydrates principle_decide options sent as a JSON string before dispatch", async () => {
    await governedExecuteTool({
      toolName: "principle_decide",
      rawParams: {
        context: "ship now vs. wait",
        callingPopulation: "external_coding_agent",
        options: JSON.stringify(STRUCTURED_OPTIONS), // <-- stringified by client
      },
      userId: "user-1",
      userContext: NORMAL_USER,
      source: "external-jsonrpc",
    });

    expect(executeMock).toHaveBeenCalledOnce();
    const dispatchedParams = executeMock.mock.calls[0]![1];
    // Pre-fix this arrived as a string -> Array.isArray() false -> "Empty options".
    expect(Array.isArray(dispatchedParams.options)).toBe(true);
    expect(dispatchedParams.options).toEqual(STRUCTURED_OPTIONS);
    expect(dispatchedParams.callingPopulation).toBe("external_coding_agent");
  });

  it("passes already-structured principle_decide args through unchanged", async () => {
    await governedExecuteTool({
      toolName: "principle_decide",
      rawParams: {
        context: "ship now vs. wait",
        callingPopulation: "human",
        options: STRUCTURED_OPTIONS, // <-- native array
      },
      userId: "user-1",
      userContext: NORMAL_USER,
      source: "external-jsonrpc",
    });

    expect(executeMock).toHaveBeenCalledOnce();
    const dispatchedParams = executeMock.mock.calls[0]![1];
    expect(dispatchedParams.options).toEqual(STRUCTURED_OPTIONS);
    expect(dispatchedParams.callingPopulation).toBe("human");
  });
});

// BI-FD7E4D72: in-portal coworker chat turns attach COWORKER_READ_BASELINE_GRANTS
// to the tool surface (agent-coworker.ts), so the execution-time agent-grant check
// must honour the SAME baseline when context.coworkerReadBaseline is set —
// otherwise a coworker whose own role grants omit a baseline grant (e.g.
// ops-coordinator without code_graph_read) gets the read tool attached but
// rejected on call. These tests use the REAL isToolAllowedByGrants (no predicate
// override) so the actual grant merge + TOOL_TO_GRANTS mapping are exercised.
describe("governedExecuteTool — coworker read-baseline at execution time", () => {
  // ops-coordinator-style grants: backlog reads only, NO code_graph_read and NO
  // backlog_write. search_code_graph requires code_graph_read (in the baseline);
  // create_backlog_item requires backlog_write (NOT in the baseline).
  const ROLE_GRANTS_WITHOUT_BASELINE = ["backlog_read"];

  it("ALLOWS a baseline-only read tool when coworkerReadBaseline is set, even though the agent's own grants lack code_graph_read", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ROLE_GRANTS_WITHOUT_BASELINE,
      // No isAllowedByGrants override → real isToolAllowedByGrants runs, so the
      // baseline merge in governedExecuteTool is what makes this pass.
      executeTool: executeMock,
      toolExecutionCreate: captureAudit(auditRows),
    });

    const result = await governedExecuteTool({
      toolName: "search_code_graph",
      rawParams: { query: "coworker tool-attachment cap" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { agentId: "ops-coordinator", coworkerReadBaseline: true },
      source: "agentic-loop",
    });

    expect(result.error).not.toBe("forbidden_grant");
    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledOnce();
    expect(auditRows[0]?.success).toBe(true);
  });

  it("still DENIES a tool whose required grant is in neither the agent's grants nor the baseline (backlog_write)", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ROLE_GRANTS_WITHOUT_BASELINE, // no backlog_write
      executeTool: executeMock,
      toolExecutionCreate: captureAudit(auditRows),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "x", type: "product", source: "user-request" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { agentId: "ops-coordinator", coworkerReadBaseline: true },
      source: "agentic-loop",
    });

    expect(result.success).toBe(false);
    expect(result).toMatchObject({
      error: "authority_denied",
      governance: { authorityReason: "agent-grant-denied" },
    });
    expect(executeMock).not.toHaveBeenCalled();
    expect(auditRows[0]?.success).toBe(false);
  });

  it("does NOT widen authority when coworkerReadBaseline is unset (autonomous/build scope unchanged)", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ROLE_GRANTS_WITHOUT_BASELINE,
      executeTool: executeMock,
      toolExecutionCreate: captureAudit(auditRows),
    });

    const result = await governedExecuteTool({
      toolName: "search_code_graph",
      rawParams: { query: "coworker tool-attachment cap" },
      userId: "user-1",
      userContext: NORMAL_USER,
      // No coworkerReadBaseline flag — an autonomous turn that never attached the
      // baseline must not gain it at execution time.
      context: { agentId: "ops-coordinator" },
      source: "agentic-loop",
    });

    expect(result.success).toBe(false);
    expect(result).toMatchObject({
      error: "authority_denied",
      governance: { authorityReason: "agent-grant-denied" },
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("governedExecuteTool — Work Case receipt context", () => {
  const WORK_CASE_CONTEXT = {
    caseRef: { caseId: "backlog-item:BI-1", sourceType: "backlog-item", sourceId: "BI-1" },
    sourceKey: "backlog-item",
    action: "complete",
    currentState: { state: "active", terminal: false },
    envelope: {
      autonomyMode: "autonomous",
      receiptPolicy: { required: true, kind: "governed-action" },
    },
  } as const;

  it("does not mint a Work Case receipt when context.workCase is absent", async () => {
    await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: {},
      userId: "user-1",
      userContext: NORMAL_USER,
      source: "rest",
    });

    expect(receiptRows).toHaveLength(0);
  });

  it("mints a governed Work Case receipt for successful consequential actions", async () => {
    const receiptUpdates: AuditRow[] = [];
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["backlog_write"],
      isAllowedByGrants: () => true,
      executeTool: executeMock,
      toolExecutionCreate: async (data: AuditRow) => {
        auditRows.push(data);
        return { id: "tool-exec-work-case-1" };
      },
      toolExecutionUpdate: async () => ({}),
      toolExecutionReceiptCreate: async (data) => {
        receiptRows.push(data); return { id: "receipt-work-case-1" };
      },
      toolExecutionReceiptUpdate: async (_id, data) => { receiptUpdates.push(data); },
      gaidActorResolver: async () => ({ principalId: "PRN-1", gaid: "GAID-1", actorKind: "owner", actorRef: "user-1" }),
    });

    await governedExecuteTool({
      toolName: "update_backlog_item_status",
      rawParams: { itemId: "BI-1", status: "done" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { workCase: WORK_CASE_CONTEXT },
      source: "external-jsonrpc",
    });

    expect(receiptRows).toHaveLength(1);
    expect(receiptRows[0]).toEqual(
      expect.objectContaining({
        buildId: null,
        executionStatus: "reserved",
        receiptKind: "work-case-governed-action",
        receiptStatus: "reserved",
        toolExecutionId: "tool-exec-work-case-1",
      }),
    );
    expect(receiptUpdates).toEqual([expect.objectContaining({ executionStatus: "succeeded", receiptStatus: "valid" })]);
  });

  it("mints an invalid governed Work Case receipt for failed consequential actions", async () => {
    const receiptUpdates: AuditRow[] = [];
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["backlog_write"],
      isAllowedByGrants: () => true,
      executeTool: vi.fn(
        async (): Promise<ToolResult> => ({
          success: false,
          error: "failed",
          message: "could not update",
        }),
      ) as ReturnType<typeof vi.fn> & ExecuteFn,
      toolExecutionCreate: async (data: AuditRow) => {
        auditRows.push(data);
        return { id: "tool-exec-work-case-2" };
      },
      toolExecutionUpdate: async () => ({}),
      toolExecutionReceiptCreate: async (data) => {
        receiptRows.push(data); return { id: "receipt-work-case-2" };
      },
      toolExecutionReceiptUpdate: async (_id, data) => { receiptUpdates.push(data); },
      gaidActorResolver: async () => ({ principalId: "PRN-1", gaid: "GAID-1", actorKind: "owner", actorRef: "user-1" }),
    });

    await governedExecuteTool({
      toolName: "update_backlog_item_status",
      rawParams: { itemId: "BI-1", status: "done" },
      userId: "user-1",
      userContext: NORMAL_USER,
      context: { workCase: WORK_CASE_CONTEXT },
      source: "external-jsonrpc",
    });

    expect(receiptRows).toHaveLength(1);
    expect(receiptRows[0]).toEqual(
      expect.objectContaining({
        executionStatus: "reserved",
        receiptKind: "work-case-governed-action",
        receiptStatus: "reserved",
        toolExecutionId: "tool-exec-work-case-2",
      }),
    );
    expect(receiptUpdates).toEqual([expect.objectContaining({ executionStatus: "failed", receiptStatus: "invalid" })]);
  });
});

describe("agentHasAnyGrant (autonomous dispatch preflight)", () => {
  it("returns false when the agent can call none of its tools", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => [],
      isAllowedByGrants: () => false,
    });
    const result = await agentHasAnyGrant("build-architect", ["read_sandbox_file", "run_sandbox_command"]);
    expect(result).toBe(false);
  });

  it("returns true when the agent can call at least one tool", async () => {
    _setGovernanceForTests({
      resolveAgentGrants: async () => ["sandbox_read"],
      isAllowedByGrants: (toolName: string) => toolName === "read_sandbox_file",
    });
    const result = await agentHasAnyGrant("build-architect", ["run_sandbox_command", "read_sandbox_file"]);
    expect(result).toBe(true);
  });

  it("returns true (nothing to gate) when no tools are attached", async () => {
    _setGovernanceForTests({ resolveAgentGrants: async () => [], isAllowedByGrants: () => false });
    expect(await agentHasAnyGrant("any-agent", [])).toBe(true);
  });
});
