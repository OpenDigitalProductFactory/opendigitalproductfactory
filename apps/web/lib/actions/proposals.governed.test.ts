// Approval convergence PR-C (BI-04E5A511, spec D5): approving a legacy
// AgentActionProposal runs convert-and-run through the REAL reference monitor
// (governedExecuteTool). Only the tool handler (executeTool) and the stores
// behind the monitor's test seams are replaced, the PR-H method.
//
// AC-LEGACY: the handler sees the characterised tool, arguments, approving
// user and the proposing coworker's { agentId, threadId }, and the row ends as
// characterised, for all four gate outcomes:
//   allow             — the tool ran inside the monitor;
//   approval_required — the approver's envelope is approved and run once;
//   settled           — an identical approved call already ran: its outcome;
//   refusal           — nothing runs, the row goes back to `proposed`.
// A double approve is refused by the compare-and-set on the row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoworkerAuthorityInput } from "@/lib/govern/authority/coworker-authority-decision";

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  proposalStatus: "proposed",
  envelope: null as null | {
    id: string; status: string; expiresAt: Date; threadId: string; taskRunId: null;
    delegatingUserId: string; coworkerAgentId: string; manifestActionId: string; argsJson: Record<string, unknown>;
  },
  audit: [] as Array<Record<string, unknown> & { id: string }>,
}));

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeTool: vi.fn(),
  approveEnvelope: vi.fn(),
  prisma: {
    agentActionProposal: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    authorizationDecisionLog: { create: vi.fn() },
    agentMessage: { create: vi.fn() },
    coworkerActionEnvelope: { findUnique: vi.fn(), findFirst: vi.fn() },
    toolExecution: { create: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/mcp-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp-tools")>()),
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/govern/current-user-context", () => ({
  currentUserContext: async (userId: string) => ({ userId, platformRole: "HR-000", isSuperuser: false }),
}));
// approveEnvelope's own state machine is covered by the envelope-actions
// tests; here it records the person's decision on the envelope the monitor
// minted, and refuses anyone but its delegate, as the real one does.
vi.mock("@/lib/coworker/envelope-actions", () => ({ approveEnvelope: mocks.approveEnvelope }));

import { _setGovernanceForTests, registerToolLifecycleHook } from "@/lib/mcp-governed-execute";
import { buildCoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { approveProposal } from "./proposals";

const TOOL = "create_backlog_item";
const PARAMS = { title: "Fix the gate", type: "product" };
const proposal = {
  proposalId: "AP-1", status: "proposed", actionType: TOOL, parameters: PARAMS,
  agentId: "AGT-COWORKER", threadId: "thread-9",
};

function authorityInput(approvalPolicy: "none" | "all", over: Partial<CoworkerAuthorityInput["action"]> = {}): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "PRN-1", principalAliases: [], population: "workforce", platformRole: "HR-000", isSuperuser: true,
      employeeId: "EMP-1", managerScope: { directReportIds: [], indirectReportIds: [] }, teamIds: [],
      accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      authentication: { source: "session", methods: [], contextClassReference: null },
      actingHumanUserId: "user-admin", actingAgentId: "AGT-COWORKER", delegationGrantIds: [], grantedCapabilities: [],
    },
    action: {
      toolName: TOOL, requiredCapability: null, agentGrantAllowed: true, sideEffect: true,
      executionMode: "immediate", routeContext: null, approvalPolicy, consequence: null, policyProjectionAllowed: false,
      ...over,
    },
    steering: "none",
    subject: { kind: "platform", id: "dpf" },
    delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true },
    rawParams: PARAMS,
  } as CoworkerAuthorityInput;
}

let input: CoworkerAuthorityInput;
let settledOutcome: { envelopeId: string; status: "executed" | "failed"; result: unknown } | null;
const finalize = vi.fn();

function governance() {
  _setGovernanceForTests({
    resolveAgentGrants: async () => [],
    isAllowedByGrants: () => true,
    toolExecutionCreate: async (data) => {
      const row = { ...data, id: `TE-${state.audit.length + 1}` };
      state.audit.push(row);
      return row;
    },
    toolExecutionUpdate: async () => ({}),
    // The resolver reports the approved envelope once the person approved it,
    // as the real resolver finds it by binding.
    resolveCoworkerAuthorityInput: async () => state.envelope?.status === "approved"
      ? { ...input, approval: {
        envelopeId: state.envelope.id, status: "approved", expiresAt: state.envelope.expiresAt,
        binding: buildCoworkerApprovalBinding(input),
      } }
      : input,
    authorizationDecisionCreate: async () => ({}),
    authorityApprovalEnvelopeCreate: (async (minted: { binding: unknown; threadId: string | null }) => {
      state.envelope = {
        id: "ENV-1", status: "proposed", expiresAt: new Date(Date.now() + 86_400_000), threadId: minted.threadId ?? "",
        taskRunId: null, delegatingUserId: "user-admin", coworkerAgentId: "AGT-COWORKER", manifestActionId: TOOL,
        argsJson: { approvalBinding: minted.binding },
      };
      return { id: "ENV-1", status: "proposed", expiresAt: state.envelope.expiresAt };
    }) as never,
    authorityApprovalTaskResume: async () => undefined,
    authorityApprovalEnvelopeFinalize: (async (envelopeId: string, success: boolean) => {
      finalize(envelopeId, success);
      if (state.envelope?.id === envelopeId) state.envelope.status = success ? "executed" : "failed";
    }) as never,
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async () => true,
    authorityExecutedOutcome: async () => settledOutcome,
  });
}

function rowWrites(): string[] {
  const calls = [
    ...mocks.prisma.agentActionProposal.updateMany.mock.calls.map(([arg], i) => ({
      order: mocks.prisma.agentActionProposal.updateMany.mock.invocationCallOrder[i]!,
      label: `cas:${arg.where.status}->${arg.data.status}`,
    })),
    ...mocks.prisma.agentActionProposal.update.mock.calls.map(([arg], i) => ({
      order: mocks.prisma.agentActionProposal.update.mock.invocationCallOrder[i]!,
      label: arg.data.status as string,
    })),
  ];
  return calls.sort((a, b) => a.order - b.order).map((c) => c.label);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.proposalStatus = "proposed";
  state.envelope = null;
  state.audit = [];
  settledOutcome = null;
  input = authorityInput("none");
  governance();
  mocks.auth.mockResolvedValue({ user: { id: "user-admin", platformRole: "HR-000", isSuperuser: true } });
  mocks.prisma.agentActionProposal.findUnique.mockImplementation(async () => ({ ...proposal, status: state.proposalStatus }));
  mocks.prisma.agentActionProposal.updateMany.mockImplementation(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
    if (state.proposalStatus !== where.status) return { count: 0 };
    state.proposalStatus = data.status;
    return { count: 1 };
  });
  mocks.prisma.agentActionProposal.update.mockImplementation(async ({ data }: { data: { status: string } }) => {
    state.proposalStatus = data.status;
    return {};
  });
  mocks.prisma.authorizationDecisionLog.create.mockResolvedValue({});
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.coworkerActionEnvelope.findUnique.mockImplementation(async () => state.envelope);
  mocks.prisma.coworkerActionEnvelope.findFirst.mockImplementation(async () => state.envelope);
  mocks.prisma.toolExecution.create.mockResolvedValue({ id: "TE-OUTCOME" });
  // The runner's park-row lookup reads what the monitor's audit wrote.
  mocks.prisma.toolExecution.findFirst.mockImplementation(async () => {
    const park = [...state.audit].reverse().find((row: Row) =>
      (row.result as { error?: string } | undefined)?.error === "approval_required");
    return park ? { parameters: park.parameters, result: park.result, threadId: park.threadId } : null;
  });
  mocks.approveEnvelope.mockImplementation(async (envelopeId: string, userId: string) => {
    if (!state.envelope || state.envelope.id !== envelopeId || state.envelope.delegatingUserId !== userId) {
      return { ok: false, reason: "Not the delegate.", httpStatus: 403 };
    }
    state.envelope.status = "approved";
    return { ok: true, envelope: state.envelope };
  });
  mocks.executeTool.mockResolvedValue({ success: true, entityId: "BI-1", message: "Created" });
});
afterEach(() => _setGovernanceForTests({}));

function expectHandlerSawTheCharacterisedCall() {
  expect(mocks.executeTool).toHaveBeenCalledTimes(1);
  expect(mocks.executeTool).toHaveBeenCalledWith(
    TOOL,
    PARAMS,
    "user-admin",
    expect.objectContaining({ agentId: "AGT-COWORKER", threadId: "thread-9", governedSource: "rest" }),
  );
  const ctx = mocks.executeTool.mock.calls[0]![3] as Record<string, unknown>;
  expect(ctx.taskRunId).toBeUndefined();
  expect(ctx.routeContext).toBeUndefined();
}

describe("approveProposal through the reference monitor (AC-LEGACY)", () => {
  it("allow: the monitor runs the tool once and the row ends executed, as characterised", async () => {
    await expect(approveProposal("AP-1")).resolves.toEqual({ success: true, resultEntityId: "BI-1" });

    expectHandlerSawTheCharacterisedCall();
    expect(rowWrites()).toEqual(["cas:proposed->approved", "executed"]);
    expect(mocks.prisma.agentActionProposal.updateMany.mock.calls[0]![0]).toEqual({
      where: { proposalId: "AP-1", status: "proposed" },
      data: { status: "approved", decidedAt: expect.any(Date), decidedById: "user-admin" },
    });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" },
      data: { status: "executed", executedAt: expect.any(Date), resultEntityId: "BI-1" },
    });
    expect(mocks.prisma.authorizationDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionKey: TOOL, objectRef: "AP-1", actorRef: "user-admin", decision: "allow",
        rationale: { proposalId: "AP-1", parameters: PARAMS, result: "Created" } }),
    });
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: { threadId: "thread-9", role: "system", content: `${TOOL} completed successfully. Created`, agentId: "AGT-COWORKER" },
    });
    // The monitor audited the call as the approver acting with the coworker.
    expect(state.audit.at(-1)).toMatchObject({ toolName: TOOL, userId: "user-admin", agentId: "AGT-COWORKER", threadId: "thread-9", success: true });
    // No envelope was involved, so there is no approval outcome to record.
    expect(mocks.prisma.toolExecution.create).not.toHaveBeenCalled();
  });

  it("allow: a tool failure ends the row failed with the tool's error", async () => {
    mocks.executeTool.mockResolvedValue({ success: false, error: "duplicate_title", message: "Exists" });
    await expect(approveProposal("AP-1")).resolves.toEqual({ success: false, error: "duplicate_title" });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" }, data: { status: "failed", resultError: "duplicate_title" },
    });
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: `${TOOL} failed: duplicate_title` }),
    });
  });

  it("approval_required: the approver's envelope is approved and run once; one system message, one outcome", async () => {
    input = authorityInput("all");

    await expect(approveProposal("AP-1")).resolves.toEqual({ success: true, resultEntityId: "BI-1" });

    expect(mocks.approveEnvelope).toHaveBeenCalledWith("ENV-1", "user-admin");
    expectHandlerSawTheCharacterisedCall();
    // The park row carried the platform-completion marker with the rest source.
    expect(state.audit[0]).toMatchObject({ result: expect.objectContaining({ error: "approval_required" }),
      parameters: expect.objectContaining({ _approvalResume: expect.objectContaining({ source: "rest" }) }) });
    expect(finalize).toHaveBeenCalledWith("ENV-1", true);
    expect(rowWrites()).toEqual(["cas:proposed->approved", "executed"]);
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" },
      data: { status: "executed", executedAt: expect.any(Date), resultEntityId: "BI-1" },
    });
    expect(mocks.prisma.authorizationDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ objectRef: "AP-1", actorRef: "user-admin", decision: "allow" }),
    });
    // The runner writes the thread message; convert-and-run does not add a second.
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: { threadId: "thread-9", role: "system", content: `${TOOL} completed successfully. Created`, agentId: "AGT-COWORKER" },
    });
    // approval_outcome is recorded exactly once, on the envelope.
    expect(mocks.prisma.toolExecution.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.toolExecution.create.mock.calls[0]![0].data).toMatchObject({
      toolName: "approval_outcome", envelopeId: "ENV-1", userId: "user-admin", success: true, result: { status: "executed" },
    });
  });

  it("settled: an identical approved call already ran, so its recorded outcome ends the row and nothing runs", async () => {
    input = authorityInput("all");
    settledOutcome = { envelopeId: "ENV-0", status: "executed", result: { success: true, message: "Created", entityId: "BI-0" } };

    await expect(approveProposal("AP-1")).resolves.toEqual({ success: true, resultEntityId: "BI-0" });

    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.approveEnvelope).not.toHaveBeenCalled();
    expect(rowWrites()).toEqual(["cas:proposed->approved", "executed"]);
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" },
      data: { status: "executed", executedAt: expect.any(Date), resultEntityId: "BI-0" },
    });
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledTimes(1);
    // The settled envelope's outcome was recorded when it ran; nothing new here.
    expect(mocks.prisma.toolExecution.create).not.toHaveBeenCalled();
  });

  it("refusal (authority denied): nothing runs, the row goes back to proposed, and the card is told why", async () => {
    input = authorityInput("none", { roomAuthorityAllowed: false });

    const result = await approveProposal("AP-1");

    expect(result).toMatchObject({ success: false, noLongerRunnable: true, error: expect.stringContaining(TOOL) });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(rowWrites()).toEqual(["cas:proposed->approved", "cas:approved->proposed"]);
    expect(mocks.prisma.agentActionProposal.updateMany.mock.calls[1]![0]).toEqual({
      where: { proposalId: "AP-1", status: "approved" },
      data: { status: "proposed", decidedAt: null, decidedById: null },
    });
    expect(state.proposalStatus).toBe("proposed");
    expect(mocks.prisma.agentMessage.create).not.toHaveBeenCalled();
    expect(mocks.prisma.authorizationDecisionLog.create).not.toHaveBeenCalled();
  });

  it("refusal (pre-tool hook): the hook's reason reaches the card and the row stays decidable", async () => {
    const unregister = registerToolLifecycleHook({ id: "test-deny", onPreToolUse: () => ({ decision: "deny", reason: "frozen for audit" }) });
    try {
      const result = await approveProposal("AP-1");
      expect(result).toMatchObject({ success: false, noLongerRunnable: true, error: expect.stringContaining("frozen for audit") });
      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(state.proposalStatus).toBe("proposed");
    } finally {
      unregister();
    }
  });

  it("a double approve is refused by the compare-and-set: the tool runs once", async () => {
    // Both clicks read `proposed` before either writes.
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(proposal);

    const outcomes = await Promise.all([approveProposal("AP-1"), approveProposal("AP-1")]);

    expect(outcomes).toContainEqual({ success: false, error: "Proposal already decided" });
    expect(outcomes).toContainEqual({ success: true, resultEntityId: "BI-1" });
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
  });
});
