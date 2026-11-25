import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findEnvelope: vi.fn(), writeDecision: vi.fn(), findPark: vi.fn(), writeOutcome: vi.fn(),
  execute: vi.fn(), resumeTask: vi.fn(), currentUser: vi.fn(),
  findAuthority: vi.fn(), findPrincipalAlias: vi.fn(), findRoom: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "owner", isSuperuser: true } }) }));
vi.mock("@dpf/db", () => ({ prisma: {
  coworkerActionEnvelope: { findUnique: m.findEnvelope, findFirst: m.findEnvelope, updateMany: m.writeDecision },
  toolExecution: { findFirst: m.findPark, create: m.writeOutcome },
  user: { findUnique: m.currentUser },
  authorizationDecisionLog: { findUnique: m.findAuthority },
  principalAlias: { findUnique: m.findPrincipalAlias },
  workroom: { findUnique: m.findRoom },
} }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: m.execute }));
vi.mock("@/lib/coworker/approved-task-run", () => ({ runApprovedTaskRequest: m.resumeTask }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [] }));

import { S5_REHEARSAL_APPROVAL_ACTION } from "@/lib/workroom-runtime/s5-rehearsal-approval-action";
import { POST } from "./route";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.resetAllMocks());

function pendingEnvelope() {
  const envelope = {
    id: "envelope-fixture", status: "proposed", resolvedAt: null, expiresAt: new Date(Date.now() + 60_000),
    delegatingUserId: "owner", coworkerAgentId: "agent-fixture", threadId: "thread-fixture",
    manifestActionId: S5_REHEARSAL_APPROVAL_ACTION, taskRunId: null, authorityDecisionId: "AUTH-FIXTURE",
    approvalBindingFingerprint: "exact-binding-fixture", inputFingerprint: "exact-input-fixture",
    argsJson: { approvalBinding: { taskRunId: null, routeContext: "/build", chainId: null } },
  };
  const room = { requestedByPrincipalId: "requester-row", archivedAt: null,
    taskRun: { taskRunId: "run-fixture", userId: "task-user", archivedAt: null } };
  m.findEnvelope.mockImplementation(async () => envelope);
  m.writeDecision.mockImplementation(async ({ data }) => {
    Object.assign(envelope, data);
    return { count: 1 };
  });
  m.currentUser.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [{ platformRole: { roleId: "HR-000" } }],
    automationVerificationId: null, automationProfile: null, automationSlot: null, automationExpiresAt: null });
  m.findAuthority.mockResolvedValue({ actorType: "human", actorRef: "owner", humanContextRef: "owner",
    agentContextRef: envelope.coworkerAgentId, actionKey: S5_REHEARSAL_APPROVAL_ACTION, objectRef: "WC-FIXTURE", decision: "require-approval",
    purposeOfUse: "synthetic-rehearsal-approval-request", rationale: { inputFingerprint: envelope.inputFingerprint,
      approverPrincipalId: "PRN-APPROVER", sessionRef: room.taskRun.taskRunId } });
  m.findPrincipalAlias.mockResolvedValue({ principal: { id: "approver-row", principalId: "PRN-APPROVER", kind: "human", status: "active" } });
  m.findRoom.mockResolvedValue(room);
  m.findPark.mockRejectedValue(new Error("decision must not enter replay lookup"));
  const approve = () => POST(new Request("http://localhost/approve", { method: "POST" }), {
    params: Promise.resolve({ envelopeId: envelope.id }),
  });
  return { envelope, room, approve };
}

describe("the rehearsal Inbox decision", () => {
  it("refuses an authenticated envelope owner without current platform permission", async () => {
    const { envelope, approve } = pendingEnvelope();
    m.currentUser.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [] });
    expect((await approve()).status).toBe(403);
    expect(envelope.status).toBe("proposed");
    expect(m.writeDecision).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.resumeTask).not.toHaveBeenCalled();
  });

  it("records the owner's decision without a send or a launch", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected provider send"));
    const { envelope, approve } = pendingEnvelope();
    const response = await approve();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, execution: { status: "not-run", reason: "decision-only" } });
    expect(m.writeDecision).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: expect.objectContaining({ status: "proposed", resolvedAt: null }),
      data: expect.objectContaining({ status: "approved", argsJson: expect.objectContaining({ humanApproval: expect.any(Object) }) }),
    }));
    expect(envelope.resolvedAt).toBeNull();
    expect(m.findPark).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.resumeTask).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(m.writeOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: expect.objectContaining({ executionMode: "approval-outcome",
        result: { status: "not-run", reason: "decision-only" } }),
    }));
  });

  it("refuses the current room requester even with platform permission and a pending envelope", async () => {
    const { envelope, room, approve } = pendingEnvelope();
    m.findRoom.mockResolvedValue({ ...room, requestedByPrincipalId: "approver-row" });
    expect((await approve()).status).toBe(403);
    expect(envelope.status).toBe("proposed");
    expect(m.writeDecision).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.resumeTask).not.toHaveBeenCalled();
  });
});
