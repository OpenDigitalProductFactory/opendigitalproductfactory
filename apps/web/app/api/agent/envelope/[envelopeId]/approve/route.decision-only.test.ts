import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@dpf/db";
import type { PermitClaims } from "@/lib/gpp/permit-claims";
import type { PermitSignature } from "@/lib/gpp/permit-handle";
import { denyEnvelope } from "@/lib/coworker/envelope-actions";
import { createS5RehearsalApprovalProducer, reviewedS5RehearsalPins, s5RehearsalDraftDigest, s5RehearsalPreviewOwnerPorts } from "@/lib/workroom-runtime/s5-rehearsal-approval-producer.server";
import { s5ApprovalFixture, s5ApprovalFixtureAgent, s5ApprovalFixtureApproverPrincipal,
  s5ApprovalFixtureAttempt as attempt, s5ApprovalFixturePreview as preview } from "@/lib/workroom-runtime/s5-rehearsal-approval.test-support";
import { POST } from "./route";

const m = vi.hoisted(() => ({
  findEnvelope: vi.fn(), createEnvelope: vi.fn(), writeDecision: vi.fn(), findPark: vi.fn(), writeOutcome: vi.fn(),
  execute: vi.fn(), resumeTask: vi.fn(), currentUser: vi.fn(), sessionUser: vi.fn(),
  findAuthority: vi.fn(), createAuthority: vi.fn(), findPrincipalAlias: vi.fn(), findRoom: vi.fn(), agentPrincipal: vi.fn(),
  agent: vi.fn(), binding: vi.fn(), workroomAccess: vi.fn(), gaids: vi.fn(), taskUpdate: vi.fn(),
  queryRaw: vi.fn(), executeRaw: vi.fn(), transaction: vi.fn(), findReceipt: vi.fn(), writeReceipt: vi.fn(), issue: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: m.sessionUser() } }) }));
vi.mock("@dpf/db", () => ({ prisma: {
  coworkerActionEnvelope: { findUnique: m.findEnvelope, findFirst: m.findEnvelope, create: m.createEnvelope, updateMany: m.writeDecision },
  toolExecution: { findFirst: m.findPark, create: m.writeOutcome },
  user: { findUnique: m.currentUser },
  authorizationDecisionLog: { findUnique: m.findAuthority, create: m.createAuthority },
  principalAlias: { findUnique: m.findPrincipalAlias }, principal: { findUnique: m.agentPrincipal },
  agent: { findUnique: m.agent }, authorityBinding: { findUnique: m.binding },
  workroom: { findUnique: m.findRoom }, taskRun: { updateMany: m.taskUpdate },
  agentThread: { upsert: async () => ({ id: "thread-fixture" }) },
  workroomActivity: { findFirst: m.findReceipt, create: m.writeReceipt },
  $queryRaw: m.queryRaw, $executeRaw: m.executeRaw, $transaction: m.transaction,
} }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: m.execute }));
vi.mock("@/lib/coworker/approved-task-run", () => ({ runApprovedTaskRequest: m.resumeTask }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [] }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: m.workroomAccess }));
vi.mock("@/lib/identity/principal-linking", () => ({ getAgentGaidMap: m.gaids }));
vi.mock("@/lib/tak/agent-grants", () => ({
  getToolGrantMapping: () => ({ get_workroom: ["room_read"], post_room_message: ["room_write"] }),
  persistedAgentToolGrants: () => ["room_read", "room_write"],
}));
vi.mock("@/lib/gpp/permit-store", () => ({ persistGppPermit: m.issue }));

const clock = new Date("2026-11-25T12:00:00.000Z");
const envelopeId = "envelope-fixture";
const actor = "task-user";
const approver = "owner";
const agent = "agent-fixture";
const human = { isActive: true, isSuperuser: false, groups: [],
  automationVerificationId: null, automationProfile: null, automationSlot: null, automationExpiresAt: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "fixture".repeat(6));
  vi.stubEnv("DPF_GPP_PERMIT_KEY_ID", "fixture");
  vi.stubEnv("DPF_ENVIRONMENT", "dev");
  vi.stubEnv("DPF_ENVIRONMENT_CLASS", "development");
  vi.stubEnv("DPF_PREVIEW_SOURCE_SHA", preview.sourceSha);
  vi.stubEnv("DPF_PREVIEW_LEASE_ID", preview.leaseId);
  vi.stubEnv("DATABASE_URL", "postgresql://dev-postgres:5432/dpf");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function fixture() {
  const draft = reviewedS5RehearsalPins.parse(s5ApprovalFixture());
  const room = { id: "room-row", capsuleId: attempt.workroomId, status: "ready", requestedByPrincipalId: "requester-row",
    archivedAt: null, workspaceState: { s5RehearsalApprovalDraft: draft, workroomDrive: { stageKey: attempt.stageKey } },
    taskRun: { taskRunId: attempt.sessionRef, userId: actor, currentAgentId: agent, status: "working", archivedAt: null } };
  const receipts = new Map<string, { kind: string; payload: unknown }>();
  let envelope: Record<string, unknown> | null = null;
  let authorization: unknown;
  m.findEnvelope.mockImplementation(async () => envelope);
  m.createEnvelope.mockImplementation(async ({ data }) => (envelope = { ...data, id: envelopeId, status: "proposed", resolvedAt: null, createdAt: clock }));
  m.writeDecision.mockImplementation(async ({ where, data }) => {
    if (!envelope || where.id !== envelope.id || (where.status !== envelope.status && !where.status?.in?.includes(envelope.status))) {
      return { count: 0 };
    }
    Object.assign(envelope, data);
    return { count: 1 };
  });
  m.createAuthority.mockImplementation(async ({ data }) => (authorization = data));
  m.findAuthority.mockImplementation(async () => authorization);
  m.sessionUser.mockReturnValue(approver);
  m.currentUser.mockImplementation(async ({ where }) => ({ ...human, isSuperuser: where.id === approver }));
  m.findPrincipalAlias.mockResolvedValue({ principal: { id: "approver-row", principalId: s5ApprovalFixtureApproverPrincipal, kind: "human", status: "active" } });
  m.findRoom.mockResolvedValue(room);
  m.workroomAccess.mockResolvedValue({ decision: { level: "content" }, authorityContext: { humanPrincipal: { id: "requester-row" } },
    agentPrincipalId: s5ApprovalFixtureAgent.principalId });
  m.gaids.mockResolvedValue(new Map([[agent, s5ApprovalFixtureAgent.gaid]]));
  m.agentPrincipal.mockResolvedValue({ aliases: [{ aliasValue: s5ApprovalFixtureAgent.gaid }] });
  m.agent.mockResolvedValue({ id: "agent-row", status: "active", archived: false, toolGrants: [], toolGrantRevocations: [] });
  m.binding.mockResolvedValue({ id: "binding-row", status: "active", scopeType: "workroom", resourceType: "work-shape",
    resourceRef: draft.shapeRef, appliedAgentId: "agent-row", grants: draft.snapshot.authority.grantKeys.map(grantKey => ({ mode: "allow", grantKey })) });
  m.findPark.mockRejectedValue(new Error("decision must not enter replay lookup"));
  m.queryRaw.mockResolvedValue([{ id: room.id }]);
  m.executeRaw.mockResolvedValue(1);
  m.findReceipt.mockImplementation(async ({ where }) => receipts.get(where.commandKey) ?? null);
  m.writeReceipt.mockImplementation(async ({ data }) => { receipts.set(data.commandKey, data); });
  m.transaction.mockImplementation(async (run: (tx: typeof prisma) => Promise<unknown>) => {
    const original = envelope && structuredClone(envelope);
    const originalReceipts = new Map(receipts);
    try { return await run(prisma); } catch (error) {
      envelope = original;
      receipts.clear();
      for (const [key, value] of originalReceipts) receipts.set(key, value);
      throw error;
    }
  });
  m.issue.mockImplementation(async (_tx: unknown, claims: PermitClaims, signature: PermitSignature) => ({
    ...claims, id: "permit-row", mac: signature.mac, keyId: signature.keyId, useCount: 0, revokedAt: null,
  }));
  const propose = createS5RehearsalApprovalProducer({
    ...s5RehearsalPreviewOwnerPorts(prisma as unknown as Parameters<typeof s5RehearsalPreviewOwnerPorts>[0]), preview,
  });
  const raise = (userId = approver) => propose(userId, { ...attempt, reviewedPinDigest: s5RehearsalDraftDigest(draft) });
  const approve = () => POST(new Request("http://localhost/approve", { method: "POST" }), {
    params: Promise.resolve({ envelopeId }),
  });
  return { room, draft, raise, approve, envelope: () => envelope };
}

describe("the rehearsal Inbox decision", () => {
  it("refuses an ordinary Workroom requester at both proposal and approval", async () => {
    const f = fixture();
    expect(await f.raise(actor)).toEqual({ kind: "held" });
    expect(m.createEnvelope).not.toHaveBeenCalled();
    expect((await f.raise()).kind).toBe("proposed");
    m.sessionUser.mockReturnValue(actor);
    expect((await f.approve()).status).toBe(403);
    expect(f.envelope()?.status).toBe("proposed");
    expect(m.issue).not.toHaveBeenCalled();
  });

  it("uses the real owner marker and issues one permit without a send or launch", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected provider send"));
    const f = fixture();
    const pending = await f.raise();
    expect(pending.kind).toBe("proposed");
    expect(m.issue).not.toHaveBeenCalled();
    expect(f.envelope()).toMatchObject({ status: "proposed" });
    vi.setSystemTime(clock.getTime() + 14 * 60_000);
    const response = await f.approve();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, execution: { status: "not-run", reason: "decision-only" } });
    expect(f.envelope()).toMatchObject({ status: "approved", resolvedAt: null, argsJson: expect.objectContaining({
      humanApproval: expect.objectContaining({ userId: approver, approvedAt: new Date().toISOString() }),
    }) });
    expect((f.envelope()?.argsJson as { humanApproval: unknown }).humanApproval).toEqual({ userId: approver, approvedAt: new Date().toISOString() });
    expect(m.issue).toHaveBeenCalledExactlyOnceWith(prisma, expect.objectContaining({
      permitId: pending.kind === "proposed" ? pending.permitRef : null, envelopeId, actorUserId: actor,
      expiresAt: new Date(Date.now() + 15 * 60_000), notBefore: new Date(), shapeRef: f.draft.shapeRef,
      capabilities: f.draft.operations.map(tool => ({ tool })), enforcement: "enforced",
    }), expect.objectContaining({ keyId: "fixture" }));
    expect((await f.approve()).status).toBe(409);
    vi.setSystemTime(clock.getTime() + 15 * 60_000);
    expect((await f.approve()).status).toBe(409);
    expect(f.envelope()).toMatchObject({ status: "approved", resolvedAt: null });
    expect(m.issue).toHaveBeenCalledOnce();
    expect(m.findPark).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.resumeTask).not.toHaveBeenCalled();
    expect(m.taskUpdate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(m.writeOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: expect.objectContaining({ executionMode: "approval-outcome", result: { status: "not-run", reason: "decision-only" } }),
    }));
  });

  it("refuses lost platform capability and the current requester even if the card is pending", async () => {
    const f = fixture();
    expect((await f.raise()).kind).toBe("proposed");
    m.currentUser.mockResolvedValue(human);
    expect((await f.approve()).status).toBe(403);
    m.currentUser.mockResolvedValue({ ...human, isSuperuser: true });
    m.findRoom.mockResolvedValue({ ...f.room, requestedByPrincipalId: "approver-row" });
    expect((await f.approve()).status).toBe(403);
    expect(f.envelope()?.status).toBe("proposed");
    expect(m.issue).not.toHaveBeenCalled();
  });

  it("rolls back the actual owner marker when permit persistence fails", async () => {
    const f = fixture();
    expect((await f.raise()).kind).toBe("proposed");
    m.issue.mockRejectedValueOnce(new Error("permit store did not write"));
    expect((await f.approve()).status).toBe(403);
    expect(f.envelope()?.status).toBe("proposed");
    expect(f.envelope()?.argsJson).not.toHaveProperty("humanApproval");
    expect(m.writeOutcome).not.toHaveBeenCalled();
  });

  it("holds on lost or substituted envelope binding metadata before issuing anything", async () => {
    const f = fixture();
    expect((await f.raise()).kind).toBe("proposed");
    const row = f.envelope()!;
    row.argsJson = { proposeBoundary: true, approvalBinding: { taskRunId: "other" } };
    expect((await f.approve()).status).toBe(403);
    row.argsJson = { proposeBoundary: true };
    expect((await f.approve()).status).toBe(403);
    expect(f.envelope()?.status).toBe("proposed");
    expect(m.issue).not.toHaveBeenCalled();
  });

  it.each(["declined", "expired"] as const)("leaves no permit when the owner request is %s", async outcome => {
    const f = fixture();
    expect((await f.raise()).kind).toBe("proposed");
    if (outcome === "declined") {
      expect(await denyEnvelope(envelopeId, approver)).toMatchObject({ ok: true });
    } else {
      vi.setSystemTime(clock.getTime() + 15 * 60_000);
    }
    const response = await f.approve();
    expect(response.status).toBe(409);
    if (outcome === "expired") expect(await response.json()).toMatchObject({ error: expect.stringContaining("cannot be reopened") });
    expect(f.envelope()?.status).toBe(outcome);
    expect(m.issue).not.toHaveBeenCalled();
  });
});
