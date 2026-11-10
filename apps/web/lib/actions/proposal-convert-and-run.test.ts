// Approval convergence PR-C review fixes (BI-04E5A511): the convert-and-run
// core through its dependency seam. The four gate outcomes against the real
// reference monitor are in proposals.governed.test.ts and the route's
// governed suite; these pin the edges the review found.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { convertAndRunProposal, type ConvertAndRunDeps } from "./proposal-convert-and-run";

const TOOL = "create_backlog_item";
const proposal = { proposalId: "AP-1", actionType: TOOL, parameters: { title: "T" }, agentId: "AGT-1", threadId: "thread-9" };
const approver = { userId: "user-1", userContext: { platformRole: "HR-000", isSuperuser: false } };

let status: string;
const db = {
  agentActionProposal: { updateMany: vi.fn(), update: vi.fn() },
  authorizationDecisionLog: { create: vi.fn() },
  agentMessage: { create: vi.fn() },
};
const execute = vi.fn();
const approveEnvelope = vi.fn();
const runApproved = vi.fn();
const recordOutcome = vi.fn();
const cancelEnvelope = vi.fn();

function deps(): ConvertAndRunDeps {
  return { db, execute, approveEnvelope, runApproved, recordOutcome, cancelEnvelope } as unknown as ConvertAndRunDeps;
}

const approvalRequired = {
  success: false, error: "approval_required", message: "Needs approval",
  data: { envelopeId: "ENV-1" }, governance: { rejected: "approval_required" },
};

function revertCalls() {
  return db.agentActionProposal.updateMany.mock.calls
    .map(([arg]) => arg)
    .filter((arg) => arg.where.status === "approved");
}

beforeEach(() => {
  vi.clearAllMocks();
  status = "proposed";
  db.agentActionProposal.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.status !== status) return { count: 0 };
    status = data.status;
    return { count: 1 };
  });
  db.agentActionProposal.update.mockImplementation(async ({ data }) => { status = data.status; return {}; });
  db.authorizationDecisionLog.create.mockResolvedValue({});
  db.agentMessage.create.mockResolvedValue({});
  approveEnvelope.mockResolvedValue({ ok: true });
  recordOutcome.mockResolvedValue(undefined);
  cancelEnvelope.mockResolvedValue({ ok: true });
});

describe("convert-and-run: a throw after the claim (review finding 1)", () => {
  it("the row is compare-and-set from approved to failed, and the throw is reported, not raised", async () => {
    execute.mockRejectedValue(new Error("db connection reset"));

    const outcome = await convertAndRunProposal(proposal, approver, { threadRecord: false }, deps());

    expect(outcome).toEqual({ kind: "threw", error: "db connection reset" });
    expect(revertCalls()).toContainEqual({
      where: { proposalId: "AP-1", status: "approved" },
      data: { status: "failed", resultError: "db connection reset" },
    });
    expect(status).toBe("failed");
  });

  it("a throw after the row was already finalised leaves it executed and reports the run", async () => {
    execute.mockResolvedValue({ success: true, entityId: "BI-1", message: "Created" });
    db.authorizationDecisionLog.create.mockRejectedValue(new Error("log down"));

    const outcome = await convertAndRunProposal(proposal, approver, { threadRecord: true }, deps());

    expect(outcome).toMatchObject({ kind: "ran", result: { success: true, entityId: "BI-1" } });
    expect(status).toBe("executed");
  });
});

describe("convert-and-run: a runner not-run after the approver approved the envelope (finding 2)", () => {
  it("cancels that envelope so a later approve cannot spend it, and refuses", async () => {
    execute.mockResolvedValue(approvalRequired);
    runApproved.mockResolvedValue({ status: "not-run", reason: "consent-changed", message: "Consent changed." });

    const outcome = await convertAndRunProposal(proposal, approver, { threadRecord: false }, deps());

    expect(outcome).toMatchObject({ kind: "refused", message: "Consent changed." });
    expect(cancelEnvelope).toHaveBeenCalledWith("ENV-1", "user-1");
    expect(status).toBe("proposed");
  });

  it("a failed cancel is logged, never raised: the row is still back to proposed", async () => {
    execute.mockResolvedValue(approvalRequired);
    runApproved.mockResolvedValue({ status: "not-run", reason: "expired", message: "Expired." });
    cancelEnvelope.mockRejectedValue(new Error("store down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await convertAndRunProposal(proposal, approver, { threadRecord: false }, deps());

    expect(outcome.kind).toBe("refused");
    expect(status).toBe("proposed");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("convert-and-run: a hold is not a settled no (finding 3)", () => {
  it("permit_required reverts the row as retryable: no refusal reason is persisted", async () => {
    execute.mockResolvedValue({
      success: false, error: "permit_required", message: "Pass the review gate first.",
      disposition: "awaiting-input", governance: { rejected: "permit_required" },
    });

    const outcome = await convertAndRunProposal(proposal, approver, { threadRecord: true }, deps());

    expect(outcome).toMatchObject({ kind: "held", message: "Pass the review gate first." });
    expect(revertCalls()).toContainEqual({
      where: { proposalId: "AP-1", status: "approved" },
      data: { status: "proposed", decidedAt: null, decidedById: null, resultError: null },
    });
    expect(db.authorizationDecisionLog.create).not.toHaveBeenCalled();
    expect(db.agentMessage.create).not.toHaveBeenCalled();
  });
});

describe("convert-and-run: a settled no (findings 5 and 8)", () => {
  const refusal = {
    success: false, error: "authority_denied", message: `${TOOL} rejected: not admitted to that room`,
    disposition: "refused", governance: { rejected: "authority_denied" },
  };

  it("persists the reason on the still-proposed row so a reload still offers Decline only", async () => {
    execute.mockResolvedValue(refusal);

    await convertAndRunProposal(proposal, approver, { threadRecord: false }, deps());

    expect(revertCalls()).toContainEqual({
      where: { proposalId: "AP-1", status: "approved" },
      data: { status: "proposed", decidedAt: null, decidedById: null, resultError: refusal.message },
    });
  });

  it("with a thread record: one decision-log row and one thread message say it was approved but could not run", async () => {
    execute.mockResolvedValue(refusal);

    await convertAndRunProposal(proposal, approver, { threadRecord: true }, deps());

    expect(db.authorizationDecisionLog.create).toHaveBeenCalledTimes(1);
    expect(db.authorizationDecisionLog.create.mock.calls[0]![0].data).toMatchObject({
      actionKey: TOOL, objectRef: "AP-1", actorType: "user", actorRef: "user-1", decision: "allow",
      rationale: { proposalId: "AP-1", refusedByMonitor: true, reason: refusal.message },
    });
    expect(db.agentMessage.create).toHaveBeenCalledWith({
      data: {
        threadId: "thread-9", role: "system", agentId: "AGT-1",
        content: `${TOOL} was approved but could not run as proposed: ${refusal.message}`,
      },
    });
  });

  it("without a thread record (the ops route) it writes neither", async () => {
    execute.mockResolvedValue(refusal);

    await convertAndRunProposal(proposal, approver, { threadRecord: false }, deps());

    expect(db.authorizationDecisionLog.create).not.toHaveBeenCalled();
    expect(db.agentMessage.create).not.toHaveBeenCalled();
  });
});

describe("convert-and-run: the platform runner's outcome (findings 6 and 7)", () => {
  it("a recorded settled outcome writes the thread message itself (the runner wrote none)", async () => {
    execute.mockResolvedValue(approvalRequired);
    runApproved.mockResolvedValue({ status: "settled", outcome: "executed", message: "Created", entityId: "BI-0" });

    const outcome = await convertAndRunProposal(proposal, approver, { threadRecord: true }, deps());

    expect(outcome).toMatchObject({ kind: "ran", result: { success: true, entityId: "BI-0" } });
    expect(db.agentMessage.create).toHaveBeenCalledTimes(1);
    expect(db.agentMessage.create).toHaveBeenCalledWith({
      data: { threadId: "thread-9", role: "system", content: `${TOOL} completed successfully. Created`, agentId: "AGT-1" },
    });
  });

  it("a fresh runner run already told the thread: no second message", async () => {
    execute.mockResolvedValue(approvalRequired);
    runApproved.mockResolvedValue({ status: "executed", message: "Created", entityId: "BI-1" });

    await convertAndRunProposal(proposal, approver, { threadRecord: true }, deps());

    expect(db.agentMessage.create).not.toHaveBeenCalled();
  });

  it("a runner failure keeps error a short code and the runner's prose in message", async () => {
    execute.mockResolvedValue(approvalRequired);
    runApproved.mockResolvedValue({ status: "failed", message: "The upstream service refused the write." });

    const outcome = await convertAndRunProposal(proposal, approver, { threadRecord: false }, deps());

    expect(outcome).toEqual({
      kind: "ran",
      result: { success: false, error: "approval_run_failed", message: "The upstream service refused the write." },
    });
    expect(db.agentActionProposal.update).toHaveBeenLastCalledWith({
      where: { proposalId: "AP-1" }, data: { status: "failed", resultError: "approval_run_failed" },
    });
  });

  it("a settled failure written by convert-and-run names the runner's prose, not the code", async () => {
    execute.mockResolvedValue(approvalRequired);
    runApproved.mockResolvedValue({ status: "settled", outcome: "failed", message: "It did not complete." });

    await convertAndRunProposal(proposal, approver, { threadRecord: true }, deps());

    expect(db.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: `${TOOL} failed: It did not complete.` }),
    });
  });
});
