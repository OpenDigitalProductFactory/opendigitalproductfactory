import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";
import { prepareS5ControlCredential } from "@/lib/auth/s5-room-credential.server";
import { generateInstanceSigningKeypair, signIdentityStatement } from "@/lib/federation/instance-identity";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { computeParamHash } from "@/lib/gpp/param-hash";
import { createS5RehearsalOwnerHandler, createS5RehearsalOwnerReads, S5_REHEARSAL_READ_PATH, s5RehearsalApprovalParams,
  s5RehearsalOwnerPin, s5RehearsalReadStatement, type S5RehearsalOwnerPorts } from "./s5-rehearsal-owner.server";

const sources = vi.hoisted(() => ({ access: vi.fn(), aliases: vi.fn(), permit: vi.fn(), mac: vi.fn() }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: sources.access }));
vi.mock("@/lib/identity/principal-linking", () => ({ getAgentGaidMap: sources.aliases }));
vi.mock("@/lib/gpp/permit-store", () => ({ readGppPermitForEvidence: sources.permit }));
vi.mock("@/lib/gpp/permit-handle", () => ({ verifyPermitMac: sources.mac }));
vi.mock("@/lib/tak/agent-grants", () => ({ getToolGrantMapping: () => ({ get_workroom: ["work_room_read"] }),
  persistedAgentToolGrants: (agent: { toolGrantRevocations: unknown[] }) => agent.toolGrantRevocations.length ? [] : ["work_room_read"] }));

const now = 1_795_560_000_000;
const leaseId = "NPEL-FIXTURE";
const sourceSha = "a".repeat(40);
const rehearsalActivity = "s5-route-handoff";
const env = { DPF_ENVIRONMENT: "dev", DPF_ENVIRONMENT_CLASS: "development", DPF_PREVIEW_LEASE_ID: leaseId,
  DPF_PREVIEW_SOURCE_SHA: sourceSha, DATABASE_URL: "postgresql://dev-postgres:5432/dpf" };
const attempt = { workroomId: "WC-FIXTURE", sessionRef: "session-a", stageKey: "coordination", stageAttemptRef: "attempt-a" };
const receiver = { issuer: "install-fixture", receiverRef: "control-fixture", hostRef: "host-fixture",
  resource: `http://localhost:3001${S5_REHEARSAL_READ_PATH}` };
const keys = generateInstanceSigningKeypair();
const qualification = { kind: "rehearsal-qualification", approvalRef: "approval-a", ownerPrincipalId: "owner-a",
  statusRevision: 3, approvalRevision: 4, validUntil: now + 90_000 };
const pinned = { ...attempt, ...receiver, profile: "synthetic-rehearsal", mode: "read-only-coordination",
  originRef: "origin-a", subject: { principalId: "principal-a", gaid: "gaid:priv:fixture:agent" },
  authority: { bindingRef: "binding-a", permitRef: "permit-a", grantKeys: ["work_room_read"] },
  qualification, expiresAt: now + 120_000,
  syntheticTarget: { environment: "non-production", fixtureRef: "fixture-a", databaseRef: `preview-db:${leaseId}`, caseKey: "case-a",
    destinationRef: "destination-a", recipient: { authorityRef: "r-auth", destinationRef: "r-dest", reservationRef: "r-res" } } };
const pin = { schemaVersion: "s5-rehearsal-owner.v1", leaseId, sourceSha, status: "active", signingPublicKey: keys.signingPublicKey,
  tokenId: "token-a", shapeRef: "shape-a", qualificationRecord: {}, snapshot: pinned };

function request(lookup = attempt, expiresAt = now + 5_000, signingKey = keys.signingPrivateKey) {
  const url = new URL(receiver.resource);
  for (const [key, value] of Object.entries(lookup)) url.searchParams.set(key, value);
  return new Request(url, { headers: { "x-dpf-s5-proof-until": String(expiresAt),
    "x-dpf-s5-proof": signIdentityStatement(signingKey, s5RehearsalReadStatement(receiver, lookup, leaseId, sourceSha, expiresAt)) } });
}

function fixture(runtimeEnv = env) {
  const readOwnerPin = vi.fn().mockResolvedValue(pin);
  const readCurrent = vi.fn().mockResolvedValue(pinned);
  const transaction = vi.fn(async (run: Parameters<S5RehearsalOwnerPorts["withOwnerRead"]>[0]) => run({ readOwnerPin, readCurrent }));
  const handler = createS5RehearsalOwnerHandler({ env: runtimeEnv, withOwnerRead: transaction, now: () => new Date(now) });
  return { handler, transaction, readOwnerPin, readCurrent };
}

describe("registered rehearsal admission owner", () => {
  it("accepts only a pinned exact Control proof and reads both owners in one transaction without caching", async () => {
    const f = fixture();
    const response = await f.handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ kind: "observed", snapshot: pinned });
    expect(f.transaction).toHaveBeenCalledOnce();
    expect(f.readOwnerPin).toHaveBeenCalledExactlyOnceWith(attempt);
    expect(f.readCurrent).toHaveBeenCalledOnce();
  });

  it("refuses production or the live DB before any owner read", async () => {
    for (const unsafe of [{ DPF_ENVIRONMENT_CLASS: "production" }, { DATABASE_URL: "postgresql://postgres:5432/dpf" },
      { DPF_PREVIEW_LEASE_ID: "" }, { DPF_PREVIEW_SOURCE_SHA: "" }]) {
      const f = fixture({ ...env, ...unsafe });
      expect((await f.handler(request())).status).toBe(404);
      expect(f.transaction).not.toHaveBeenCalled();
    }
  });

  it("refuses another key, expired proof, route confusion or a different attempt before current-owner reads", async () => {
    const f = fixture();
    const wrong = generateInstanceSigningKeypair().signingPrivateKey;
    const duplicate = new URL(request().url);
    duplicate.searchParams.append("stageKey", attempt.stageKey);
    for (const input of [request(attempt, now + 500, wrong), request(attempt, now),
      request({ ...attempt, stageAttemptRef: "other" }),
      new Request(duplicate, { headers: request().headers }),
      new Request(request().url, { headers: { authorization: "Bearer fixture" } })]) {
      expect((await f.handler(input)).status).toBe(404);
    }
    expect(f.readCurrent).not.toHaveBeenCalled();
  });

  it("holds on a revoked owner record, changed current facts or a pin from a previous lease", async () => {
    const f = fixture();
    f.readCurrent.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...pinned, qualification: { ...qualification, approvalRevision: 5 } });
    expect((await f.handler(request())).status).toBe(404);
    expect((await f.handler(request())).status).toBe(404);
    f.readOwnerPin.mockResolvedValue({ ...pin, leaseId: "another-lease" });
    expect((await f.handler(request())).status).toBe(404);
    expect(f.readCurrent).toHaveBeenCalledTimes(2);
  });
});

function database() {
  const date = (ms: number) => new Date(ms);
  const approvalTime = now - 3_000;
  const approvalDeadline = now - 1_000;
  const permitDeadline = approvalTime + 15 * 60_000;
  const waiver = { ...qualification, kind: "rehearsal-qualification" as const, approvalRevision: approvalTime };
  const snapshot = { ...pinned, qualification: waiver, expiresAt: waiver.validUntil - 10 };
  const binding = { issuer: receiver.issuer, ...attempt, subject: pinned.subject, syntheticTarget: pinned.syntheticTarget };
  const ownerPin = s5RehearsalOwnerPin.parse({ ...pin, snapshot, qualificationRecord: {
    schemaVersion: "s5-rehearsal-qualification.v1", approvalRef: waiver.approvalRef, ownerPrincipalId: waiver.ownerPrincipalId,
    status: "active", statusRevision: waiver.statusRevision, issuedAt: approvalTime, validUntil: waiver.validUntil, binding,
  } });
  const agentId = "AGT-FIXTURE";
  const userId = "user-fixture";
  const approverId = "platform-approver";
  const approverAlias = { principal: { id: "platform-approver-row", principalId: waiver.ownerPrincipalId, kind: "human", status: "active" } };
  const human = { isActive: true, isSuperuser: false, groups: [] as { platformRole: { roleId: string } }[],
    automationVerificationId: null, automationProfile: null, automationSlot: null, automationExpiresAt: null };
  const platformApprover = { ...human, groups: [{ platformRole: { roleId: "HR-000" } }] };
  const params = s5RehearsalApprovalParams({ ...ownerPin, approverPrincipalId: waiver.ownerPrincipalId,
    operations: ["get_workroom"], approvalExpiresAt: approvalDeadline });
  const paramsFingerprint = fingerprintCoworkerInput(params);
  const original = prepareS5ControlCredential({
    executionProfile: "synthetic-rehearsal", receiver: { ...receiver, audience: receiver.receiverRef }, userId,
    now: date(now), expiresAt: date(snapshot.expiresAt), admission: {
      kind: "composed", locator: { workroomId: attempt.workroomId, sessionRef: attempt.sessionRef, stageAttemptRef: attempt.stageAttemptRef },
      issuer: receiver.issuer, stageKey: attempt.stageKey, caseKey: pinned.syntheticTarget.caseKey, subject: pinned.subject,
      authorityBindingId: "binding-row", ...pinned.authority, agentId, activityKey: rehearsalActivity, job: { id: "job", version: "1" },
      host: { hostRef: receiver.hostRef, receiverRef: receiver.receiverRef, worktreeRef: null, mode: "read-only-coordination" },
      jsi: { ...waiver, syntheticTarget: ownerPin.snapshot.syntheticTarget }, operationKeys: ["get_workroom"],
    },
  })!;
  const approval = { id: waiver.approvalRef, status: "approved", resolvedAt: null, manifestActionId: "s5-single-synthetic-rehearsal",
    delegatingUserId: approverId, coworkerAgentId: agentId, approvalBindingFingerprint: "bound", inputFingerprint: paramsFingerprint,
    authorityDecisionId: "AUTH-FIXTURE",
    expiresAt: date(approvalDeadline), argsJson: { humanApproval: { userId: approverId, approvedAt: date(approvalTime).toISOString() } } };
  const permit = { enforcement: "enforced", revokedAt: null, envelopeId: approval.id, workroomId: attempt.workroomId, stageKey: attempt.stageKey,
    shapeRef: pin.shapeRef, actorAgentId: agentId, actorUserId: userId, actorGaid: pinned.subject.gaid, maxUses: 1, useCount: 0,
    notBefore: date(approvalTime), expiresAt: date(permitDeadline), capabilities: [{ tool: "get_workroom" }],
    bindingId: "s5-single-synthetic-rehearsal", authorityDecisionId: approval.authorityDecisionId,
    subjectScope: attempt.stageAttemptRef, paramHash: computeParamHash("s5-single-synthetic-rehearsal", params) };
  const tx = {
    workroom: { findUnique: vi.fn().mockResolvedValue({ id: "room-row", status: "ready", archivedAt: null, requestedByPrincipalId: "owner-row",
      taskRun: { taskRunId: attempt.sessionRef, status: "working", archivedAt: null, userId, currentAgentId: agentId },
      workspaceState: { s5RehearsalAdmission: ownerPin, workroomDrive: { stageKey: attempt.stageKey } } }) },
    mcpApiToken: { findFirst: vi.fn().mockResolvedValue({ ...original.data, revokedAt: null }) },
    coworkerActionEnvelope: { findUnique: vi.fn().mockResolvedValue(approval) },
    principal: { findUnique: vi.fn().mockResolvedValue({ status: "active", kind: "agent", aliases: [{ aliasValue: pinned.subject.gaid }] }) },
    principalAlias: { findUnique: vi.fn().mockResolvedValue(approverAlias) },
    agent: { findUnique: vi.fn().mockResolvedValue({ id: "agent-row", status: "active", archived: false, toolGrants: [], toolGrantRevocations: [] }) },
    authorityBinding: { findUnique: vi.fn().mockResolvedValue({ bindingId: pinned.authority.bindingRef, status: "active", appliedAgentId: "agent-row",
      resourceRef: pin.shapeRef, resourceType: "work-shape", scopeType: "workroom", grants: [{ grantKey: "work_room_read", mode: "allow" }] }) },
    user: { findUnique: vi.fn(async ({ where }) => (where.id === approverId ? platformApprover : human)) },
  };
  sources.access.mockReset().mockResolvedValue({ decision: { level: "content" }, agentPrincipalId: pinned.subject.principalId,
    authorityContext: { humanPrincipal: { id: "owner-row" } } });
  sources.aliases.mockReset().mockResolvedValue(new Map([[agentId, pinned.subject.gaid]]));
  sources.permit.mockReset().mockResolvedValue(permit);
  sources.mac.mockReset().mockReturnValue({ result: "ok" });
  const clock = vi.fn(() => date(now));
  const handler = createS5RehearsalOwnerHandler({ env, now: clock,
    withOwnerRead: read => read(createS5RehearsalOwnerReads(tx as unknown as Prisma.TransactionClient)) });
  return { handler, tx, approval, permit, snapshot, human, platformApprover, approverAlias, clock };
}

describe("database owner join with client hooks absent", () => {
  it("holds when the approval belongs to the Workroom requester rather than an independent platform approver", async () => {
    const f = database();
    const room = await f.tx.workroom.findUnique();
    f.tx.coworkerActionEnvelope.findUnique.mockResolvedValueOnce({
      ...f.approval, delegatingUserId: room.taskRun.userId,
      argsJson: { humanApproval: { ...f.approval.argsJson.humanApproval, userId: room.taskRun.userId } },
    });
    expect((await f.handler(request())).status).toBe(404);
  });

  it("observes a current admission even after the answered Inbox approval window closed", async () => {
    const f = database();
    const response = await f.handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "observed", snapshot: f.snapshot });
    expect(sources.access).toHaveBeenCalledWith(expect.objectContaining({ workroomId: "room-row", requested: "content" }), f.tx);
    expect(f.tx.coworkerActionEnvelope.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: f.approval.id } });
  });

  it("refuses at execution deadline equality while approval and permit are still current", async () => {
    const f = database();
    const deadline = f.snapshot.expiresAt;
    const proof = request(attempt, deadline + 5_000);
    f.clock.mockReturnValue(new Date(deadline - 1));
    expect((await f.handler(proof)).status).toBe(200);
    f.clock.mockReturnValue(new Date(deadline));
    expect((await f.handler(proof)).status).toBe(404);
  });

  it("holds on revoked platform capability, a new Principal behind the approver, or requester alias reuse", async () => {
    const f = database();
    f.tx.user.findUnique.mockResolvedValue(f.human);
    expect((await f.handler(request())).status).toBe(404);
    f.tx.user.findUnique.mockResolvedValue({ ...f.human, isSuperuser: true });
    expect((await f.handler(request())).status).toBe(200);
    f.tx.principalAlias.findUnique.mockResolvedValueOnce({ principal: { ...f.approverAlias.principal, principalId: "another-principal" } });
    expect((await f.handler(request())).status).toBe(404);
    f.tx.principalAlias.findUnique.mockResolvedValueOnce({ principal: { ...f.approverAlias.principal, id: "owner-row" } });
    expect((await f.handler(request())).status).toBe(404);
  });

  it("holds when the permit's shape, operations, or absolute deadline differ from the approval", async () => {
    const f = database();
    sources.permit.mockResolvedValueOnce({ ...f.permit, shapeRef: "substitute" });
    expect((await f.handler(request())).status).toBe(404);
    sources.permit.mockResolvedValueOnce({ ...f.permit, capabilities: [...f.permit.capabilities, { tool: "post_room_message" }] });
    expect((await f.handler(request())).status).toBe(404);
    const later = new Date(f.permit.expiresAt.getTime() + 1);
    f.tx.coworkerActionEnvelope.findUnique.mockResolvedValueOnce({ ...f.approval, expiresAt: later });
    sources.permit.mockResolvedValueOnce({ ...f.permit, expiresAt: later });
    expect((await f.handler(request())).status).toBe(404);
  });

  it("holds when any current owner withdraws permission while the persisted pin is unchanged", async () => {
    const f = database();
    f.tx.coworkerActionEnvelope.findUnique.mockResolvedValueOnce({ ...f.approval, status: "cancelled" });
    expect((await f.handler(request())).status).toBe(404);
    f.tx.coworkerActionEnvelope.findUnique.mockResolvedValueOnce({ ...f.approval, inputFingerprint: "not-this-attempt" });
    expect((await f.handler(request())).status).toBe(404);
    sources.permit.mockResolvedValueOnce({ ...f.permit, revokedAt: new Date(now) });
    expect((await f.handler(request())).status).toBe(404);
    sources.mac.mockReturnValueOnce({ result: "unsigned" });
    expect((await f.handler(request())).status).toBe(404);
    sources.aliases.mockResolvedValueOnce(new Map());
    expect((await f.handler(request())).status).toBe(404);
    f.tx.user.findUnique.mockResolvedValueOnce({ ...f.human, isActive: false });
    expect((await f.handler(request())).status).toBe(404);
    f.tx.agent.findUnique.mockResolvedValueOnce({ id: "agent-row", status: "active", archived: false, toolGrantRevocations: ["revoked"] });
    expect((await f.handler(request())).status).toBe(404);
  });
});
