// Approval convergence A3 (BI-C8EC05C9): the gate under a propose boundary.
//
//   - It mints through the one minting path, carrying the server-set flag and
//     chat message to the envelope (spec D1, D2).
//   - AC-NOPARK: an approved envelope for the identical binding is allowed and
//     spent once; nothing new is minted or parked.
//   - A boundary envelope never pauses its TaskRun, so the gate never resumes
//     one either (spec D2 S2, "No pause").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import type { ToolDefinition } from "@/lib/mcp-tool-types";

import { buildCoworkerApprovalBinding, type CoworkerAuthorityInput } from "./coworker-authority-decision";
import { enforceCoworkerToolAuthority, setCoworkerToolAuthorityOverridesForTests } from "./coworker-tool-authority-gate";
import { GOVERNED_REJECTION_DISPOSITION, rejectionMessage } from "./governed-rejection-disposition";

const TOOL = { name: "run_discovery_triage", sideEffect: true, executionMode: "immediate" } as unknown as ToolDefinition;

function execution(context: GovernedExecuteArgs["context"] = {}): GovernedExecuteArgs {
  return {
    toolName: "run_discovery_triage",
    rawParams: { trigger: "cadence" },
    userId: "user-1",
    userContext: { userId: "user-1", platformRole: "HR-000", isSuperuser: true },
    context: { agentId: "AGT-OPS", threadId: "thread-1", taskRunId: "TR-SCHED-1", ...context },
    source: "agentic-loop",
  };
}

function authorityInput(proposeBoundary: boolean): CoworkerAuthorityInput {
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
      toolName: "run_discovery_triage", requiredCapability: null, agentGrantAllowed: true, sideEffect: true,
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
    rawParams: { trigger: "cadence" },
  };
}

let ensure: ReturnType<typeof vi.fn>;
let resume: ReturnType<typeof vi.fn>;
let reserve: ReturnType<typeof vi.fn>;

function arrange(input: CoworkerAuthorityInput) {
  ensure = vi.fn(async () => ({ id: "ENV-NEW", status: "proposed", expiresAt: new Date(Date.now() + 7 * 86_400_000) }));
  resume = vi.fn(async () => undefined);
  reserve = vi.fn(async () => true);
  setCoworkerToolAuthorityOverridesForTests({
    resolveCoworkerAuthorityInput: async () => input,
    authorizationDecisionCreate: async () => ({}),
    authorityApprovalEnvelopeCreate: ensure as never,
    authorityApprovalTaskResume: resume as never,
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: reserve as never,
    authorityExecutedOutcome: async () => null,
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => setCoworkerToolAuthorityOverridesForTests({
  resolveCoworkerAuthorityInput: null, authorizationDecisionCreate: null, authorityApprovalEnvelopeCreate: null,
  authorityApprovalTaskResume: null, policyAuthorityProjectionAttempt: null, policyAuthorityEnvelopeReserve: null,
  authorityExecutedOutcome: null,
}));

describe("coworker tool authority gate — the propose boundary", () => {
  it("mints through the one path, carrying the boundary flag and the chat message", async () => {
    arrange(authorityInput(true));
    const result = await enforceCoworkerToolAuthority(
      execution({ proposeBoundary: true, approvalCompletion: "platform", chatMessageId: "MSG-1" }), TOOL, true,
    );
    expect(result).toMatchObject({ outcome: "reject", rejection: "approval_required", data: { envelopeId: "ENV-NEW" } });
    expect(ensure).toHaveBeenCalledWith(expect.objectContaining({
      proposeBoundary: true,
      chatMessageId: "MSG-1",
      binding: buildCoworkerApprovalBinding(authorityInput(true)),
      explanation: expect.stringContaining("set to propose, not act"),
    }));
  });

  it("passes neither flag for an ordinary call, so existing mints are unchanged", async () => {
    const input = { ...authorityInput(false), action: { ...authorityInput(false).action, approvalPolicy: "all" as const } , steering: "none" as const };
    arrange(input);
    await enforceCoworkerToolAuthority(execution(), TOOL, true);
    const minted = ensure.mock.calls[0]![0] as Record<string, unknown>;
    expect(minted).not.toHaveProperty("proposeBoundary");
    expect(minted).not.toHaveProperty("chatMessageId");
  });

  it("AC-NOPARK: an approved envelope for the identical binding is allowed and spent once, with no mint and no resume", async () => {
    const input = authorityInput(true);
    arrange({
      ...input,
      approval: {
        envelopeId: "ENV-APPROVED", status: "approved", expiresAt: new Date(Date.now() + 60_000),
        binding: buildCoworkerApprovalBinding(input), proposeBoundary: true,
      },
    });
    const result = await enforceCoworkerToolAuthority(execution({ proposeBoundary: true }), TOOL, true);
    expect(result).toMatchObject({ outcome: "allow", approvedEnvelopeId: "ENV-APPROVED" });
    expect(reserve).toHaveBeenCalledOnce();
    expect(ensure).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("an approved envelope without the flag still resumes its task, as before", async () => {
    const input = { ...authorityInput(false), action: { ...authorityInput(false).action, approvalPolicy: "all" as const }, steering: "none" as const };
    arrange({
      ...input,
      approval: { envelopeId: "ENV-OLD", status: "approved", expiresAt: new Date(Date.now() + 60_000), binding: buildCoworkerApprovalBinding(input) },
    });
    await enforceCoworkerToolAuthority(execution(), TOOL, true);
    expect(resume).toHaveBeenCalledWith("TR-SCHED-1");
  });
});

describe("deterministic authority resolution refusals (BI-5FDE148A)", () => {
  const tool = { name: "get_backlog_item", sideEffect: false, executionMode: "immediate" } as unknown as ToolDefinition;

  function missingItemCall(): GovernedExecuteArgs {
    return {
      toolName: "get_backlog_item",
      rawParams: { itemId: "BI-MISSING" },
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: "HR-000", isSuperuser: true },
      context: { agentId: "AGT-OPS" },
      source: "external-jsonrpc",
    };
  }

  function throwResolution(error: unknown) {
    setCoworkerToolAuthorityOverridesForTests({
      resolveCoworkerAuthorityInput: async () => {
        throw error;
      },
    });
  }

  function callerMessage(result: Awaited<ReturnType<typeof enforceCoworkerToolAuthority>>, toolName: string): string {
    if (result.outcome !== "reject") throw new Error(`expected a rejection, got ${result.outcome}`);
    return rejectionMessage(toolName, result.message, GOVERNED_REJECTION_DISPOSITION[result.rejection]);
  }

  it("refuses an unknown item on a non-create tool instead of reporting the check unavailable", async () => {
    throwResolution(new Error("The governed backlog item does not exist."));
    const result = await enforceCoworkerToolAuthority(missingItemCall(), tool, true);
    expect(result).toMatchObject({
      outcome: "reject",
      rejection: "authority_subject_not_found",
      message: "The governed backlog item does not exist.",
    });
    const caller = callerMessage(result, "get_backlog_item");
    expect(GOVERNED_REJECTION_DISPOSITION.authority_subject_not_found).toBe("refused");
    expect(caller).toContain("The governed backlog item does not exist.");
    expect(caller).not.toMatch(/unavailable/i);
    expect(caller).not.toMatch(/retried unchanged/);
  });

  it("refuses a writer-tool binding mismatch instead of asking for an unchanged retry", async () => {
    const reason = "The immutable initiative review writer tool does not match the executing tool.";
    throwResolution(new Error(reason));
    const result = await enforceCoworkerToolAuthority(missingItemCall(), tool, true);
    expect(result).toMatchObject({ outcome: "reject", rejection: "authority_binding_mismatch", message: reason });
    const caller = callerMessage(result, "record_initiative_design_review");
    expect(caller).toContain("writer tool does not match");
    expect(GOVERNED_REJECTION_DISPOSITION.authority_binding_mismatch).toBe("refused");
    expect(caller).not.toMatch(/unavailable|retried unchanged/);
  });

  it.each([
    ["connect ETIMEDOUT", "connect ETIMEDOUT"],
    ["pool timeout", "Timed out fetching a new connection from the connection pool"],
    ["missing relation", 'relation "BacklogItem" does not exist'],
  ])("keeps a %s failure inconclusive", async (_label, reason) => {
    throwResolution(new Error(reason));
    const result = await enforceCoworkerToolAuthority(missingItemCall(), tool, true);
    expect(result).toMatchObject({
      outcome: "reject",
      rejection: "authority_evidence_unavailable",
      message: reason,
    });
    expect(GOVERNED_REJECTION_DISPOSITION.authority_evidence_unavailable).toBe("inconclusive");
    const caller = callerMessage(result, "get_backlog_item");
    expect(caller).toContain(reason);
    expect(caller).toMatch(/retried unchanged/);
    expect(caller).toMatch(/unavailable/);
  });
});
