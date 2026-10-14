// Approval convergence PR-C (BI-04E5A511, spec D5, plan C2): the superuser
// execute-proposal route calls only the shared convert-and-run core, which runs
// through the REAL reference monitor. Only the tool handler and the stores
// behind the monitor's test seams are replaced (the PR-H method).
//
// The route keeps its own { ok, result } shape and status codes, writes no
// system message or decision log of its own, and the X-Ops-Token path is gone
// (waiver W3): a superuser session is the only way in.
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
  cancelEnvelope: vi.fn(),
  prisma: {
    agentActionProposal: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    authorizationDecisionLog: { create: vi.fn() },
    agentMessage: { create: vi.fn() },
    coworkerActionEnvelope: { findUnique: vi.fn(), findFirst: vi.fn() },
    toolExecution: { create: vi.fn(), findFirst: vi.fn() },
    featureBuild: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/mcp-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp-tools")>()),
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/govern/current-user-context", () => ({
  currentUserContext: async (userId: string) => ({ userId, platformRole: "HR-000", isSuperuser: true }),
}));
vi.mock("@/lib/coworker/envelope-actions", () => ({ approveEnvelope: mocks.approveEnvelope, cancelEnvelope: mocks.cancelEnvelope }));

import { _setGovernanceForTests } from "@/lib/mcp-governed-execute";
import { buildCoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { POST } from "./route";

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
      actingHumanUserId: "user-su", actingAgentId: "AGT-COWORKER", delegationGrantIds: [], grantedCapabilities: [],
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
        taskRunId: null, delegatingUserId: "user-su", coworkerAgentId: "AGT-COWORKER", manifestActionId: TOOL,
        argsJson: { approvalBinding: minted.binding },
      };
      return { id: "ENV-1", status: "proposed", expiresAt: state.envelope.expiresAt };
    }) as never,
    authorityApprovalTaskResume: async () => undefined,
    authorityApprovalEnvelopeFinalize: (async (envelopeId: string, success: boolean) => {
      if (state.envelope?.id === envelopeId) state.envelope.status = success ? "executed" : "failed";
    }) as never,
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async () => true,
    authorityExecutedOutcome: async () => settledOutcome,
  });
}

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/ops/execute-proposal", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HIVE_OPS_TOKEN;
  state.proposalStatus = "proposed";
  state.envelope = null;
  state.audit = [];
  settledOutcome = null;
  input = authorityInput("none");
  governance();
  mocks.auth.mockResolvedValue({ user: { id: "user-su", isSuperuser: true, platformRole: "HR-000" } });
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
  mocks.prisma.agentMessage.create.mockResolvedValue({});
  mocks.prisma.coworkerActionEnvelope.findUnique.mockImplementation(async () => state.envelope);
  mocks.prisma.coworkerActionEnvelope.findFirst.mockImplementation(async () => state.envelope);
  mocks.prisma.toolExecution.create.mockResolvedValue({ id: "TE-OUTCOME" });
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
    TOOL, PARAMS, "user-su",
    expect.objectContaining({ agentId: "AGT-COWORKER", threadId: "thread-9", governedSource: "rest" }),
  );
}

describe("POST /api/admin/ops/execute-proposal through the reference monitor (AC-LEGACY)", () => {
  it("allow: runs once as the superuser and keeps { ok, result }; no system message or decision log of its own", async () => {
    const res = await POST(request({ proposalId: "AP-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: { success: true, entityId: "BI-1", message: "Created" } });
    expectHandlerSawTheCharacterisedCall();
    expect(mocks.prisma.agentActionProposal.updateMany.mock.calls[0]![0]).toEqual({
      where: { proposalId: "AP-1", status: "proposed" },
      data: { status: "approved", decidedAt: expect.any(Date), decidedById: "user-su" },
    });
    expect(mocks.prisma.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" },
      data: { status: "executed", executedAt: expect.any(Date), resultEntityId: "BI-1" },
    });
    expect(mocks.prisma.agentMessage.create).not.toHaveBeenCalled();
    expect(mocks.prisma.authorizationDecisionLog.create).not.toHaveBeenCalled();
  });

  it("approval_required: the superuser's envelope is approved and run once; the outcome is recorded once", async () => {
    input = authorityInput("all");

    const res = await POST(request({ proposalId: "AP-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: { success: true, entityId: "BI-1" } });
    expect(mocks.approveEnvelope).toHaveBeenCalledWith("ENV-1", "user-su");
    expectHandlerSawTheCharacterisedCall();
    expect(state.proposalStatus).toBe("executed");
    // Only the runner's thread message; the route adds none.
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.authorizationDecisionLog.create).not.toHaveBeenCalled();
    expect(mocks.prisma.toolExecution.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.toolExecution.create.mock.calls[0]![0].data).toMatchObject({ toolName: "approval_outcome", envelopeId: "ENV-1" });
  });

  it("settled: returns the recorded outcome and runs nothing", async () => {
    input = authorityInput("all");
    settledOutcome = { envelopeId: "ENV-0", status: "executed", result: { success: true, message: "Created", entityId: "BI-0" } };

    const res = await POST(request({ proposalId: "AP-1" }));

    expect(await res.json()).toMatchObject({ ok: true, result: { success: true, entityId: "BI-0" } });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(state.proposalStatus).toBe("executed");
  });

  it("refusal: nothing runs, the row goes back to proposed, and the refusal is returned as ok:false", async () => {
    input = authorityInput("none", { roomAuthorityAllowed: false });

    const res = await POST(request({ proposalId: "AP-1" }));

    expect(res.status).toBe(200);
    // `refused` tells a recovery script a settled no from a run that failed (review finding 9).
    expect(await res.json()).toMatchObject({ ok: false, refused: true, result: { success: false, error: "authority_denied" } });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(state.proposalStatus).toBe("proposed");
    // The route writes no thread record of its own.
    expect(mocks.prisma.agentMessage.create).not.toHaveBeenCalled();
    expect(mocks.prisma.authorizationDecisionLog.create).not.toHaveBeenCalled();
  });

  it("a tool failure carries no refused flag", async () => {
    mocks.executeTool.mockResolvedValue({ success: false, error: "duplicate_title", message: "Exists" });

    const res = await POST(request({ proposalId: "AP-1" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, result: { success: false, error: "duplicate_title" } });
    expect(body).not.toHaveProperty("refused");
  });

  it("a throw after the claim does not strand the row approved: it ends failed and the route answers 500 (finding 1)", async () => {
    mocks.prisma.agentActionProposal.update.mockRejectedValue(new Error("db connection reset"));

    const res = await POST(request({ proposalId: "AP-1" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "db connection reset" });
    expect(mocks.prisma.agentActionProposal.updateMany).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1", status: "approved" },
      data: { status: "failed", resultError: "db connection reset" },
    });
    expect(state.proposalStatus).toBe("failed");
  });

  it("a double execute is refused by the compare-and-set with 409: the tool runs once", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValueOnce(proposal).mockResolvedValueOnce(proposal);

    const [first, second] = await Promise.all([POST(request({ proposalId: "AP-1" })), POST(request({ proposalId: "AP-1" }))]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
  });

  it("W3: an X-Ops-Token request without a session gets 401, even with the secret configured", async () => {
    process.env.HIVE_OPS_TOKEN = "secret";
    mocks.auth.mockResolvedValue(null);

    const res = await POST(request({ proposalId: "AP-1", userId: "user-creator" }, { "x-ops-token": "secret" }));

    expect(res.status).toBe(401);
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.prisma.agentActionProposal.updateMany).not.toHaveBeenCalled();
  });
});
