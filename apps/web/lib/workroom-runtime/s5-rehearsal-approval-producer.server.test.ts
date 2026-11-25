import { describe, expect, it, vi } from "vitest";
import { fingerprintCoworkerApprovalBinding, fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { signPermit, verifyPermitMac } from "@/lib/gpp/permit-handle";
import type { ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { createS5RehearsalApprovalCommit, createS5RehearsalApprovalProducer, reviewedS5RehearsalPins, s5RehearsalDraftDigest, s5RehearsalPreviewOwnerPorts,
  type S5RehearsalProducerPorts } from "./s5-rehearsal-approval-producer.server";

import { s5ApprovalFixture, s5ApprovalFixtureAgent as principal, s5ApprovalFixtureApproverPrincipal as approverPrincipalId,
  s5ApprovalFixtureAttempt as exact, s5ApprovalFixturePreview as preview } from "./s5-rehearsal-approval.test-support";

const t = 1_795_560_000_000;
const actor = "reviewing-owner";
const taskUserId = "workroom-requester";
const fixture = s5ApprovalFixture(t + 100_000);
const permitRef = "GPM-5243395b-a0a4-4449-87e8-7a8107e91579";
const signingOptions = { secret: "x".repeat(32), keyId: "test" };

function setup() {
  const draft = reviewedS5RehearsalPins.parse(fixture);
  const request = { ...exact, reviewedPinDigest: s5RehearsalDraftDigest(draft) };
  const rows = new Map<string, { kind: string; payload: unknown }>();
  const tx: ReceiptDb = {
    $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([{ id: "room-row" }]),
    workroomActivity: { findFirst: vi.fn(async (args: unknown) => rows.get((args as { where: { commandKey: string } }).where.commandKey) ?? null),
      create: vi.fn(async (args: unknown) => { const d = (args as { data: { commandKey: string; kind: string; payload: unknown } }).data; rows.set(d.commandKey, d); }) },
  };
  const db = { ...tx, $transaction: async <T>(run: (tx: ReceiptDb) => Promise<T>) => run(tx) };
  const current = { draft, approverUserId: actor, approverPrincipalId, taskUserId, agentId: "AGT-FIXTURE", bindingRowId: "binding-row" };
  const loadCurrent = vi.fn<S5RehearsalProducerPorts["loadCurrent"]>().mockResolvedValue(current);
  const raisePending = vi.fn<S5RehearsalProducerPorts["raisePending"]>().mockResolvedValue({ envelopeId: "env-a", status: "proposed", expiresAt: new Date(draft.expiresAt), authorityDecisionId: "AUTH-A" });
  const persistPermit = vi.fn<S5RehearsalProducerPorts["persistPermit"]>().mockImplementation(async (_tx, claims, signature) => ({
    ...claims, keyId: signature.keyId, mac: signature.mac, useCount: 0, revokedAt: null, id: "permit-row",
  }));
  const now = vi.fn(() => new Date(t));
  const reserve = vi.fn(() => permitRef);
  const approvalIntent = { attempt: exact, reviewedPinDigest: request.reviewedPinDigest, permitRef, approverPrincipalId, bindingRowId: current.bindingRowId };
  const readDecision = vi.fn<S5RehearsalProducerPorts["readDecision"]>().mockResolvedValue(approvalIntent);
  const ports = { db, preview, now, locateRoom: async () => "room-row", readDecision,
    loadCurrent, raisePending, persistPermit, reservePermitRef: reserve, nonce: () => "nonce", sign: p => signPermit(p, signingOptions),
    verify: p => verifyPermitMac(p, null, signingOptions).result === "ok" } satisfies S5RehearsalProducerPorts;
  const producer = createS5RehearsalApprovalProducer(ports);
  const commit = createS5RehearsalApprovalCommit(ports);
  const approve = vi.fn(async (_tx: ReceiptDb) => ({ ok: true } as const));
  function envelope() {
    const { binding, deadline } = raisePending.mock.calls[0]![1];
    return { id: "env-a", manifestActionId: binding.toolName, expiresAt: deadline, authorityDecisionId: "AUTH-A",
      inputFingerprint: binding.inputFingerprint, approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
      delegatingUserId: binding.actingHumanUserId, coworkerAgentId: binding.actingAgentId,
      argsJson: { proposeBoundary: true, approvalBinding: binding } };
  }
  return { producer, draft, request, current, loadCurrent, raisePending, persistPermit, reserve, now, rows, tx,
    approve, commit, envelope, readDecision, approvalIntent };
}

describe("S5 preview-only approval producer", () => {
  it("binds the shape, operations and absolute deadline but never issues a permit for a pending envelope", async () => {
    const f = setup();
    expect((await f.producer(actor, f.request)).kind).toBe("proposed");
    expect(f.raisePending.mock.calls[0]?.[1].params).toMatchObject({
      shapeRef: f.draft.shapeRef, operations: f.draft.operations, expiresAt: f.draft.expiresAt,
    });
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("issues the reserved enforced permit only in the approved decision transaction", async () => {
    const f = setup();
    expect(await f.producer(actor, f.request)).toEqual({ kind: "proposed", envelopeId: "env-a", permitRef, expiresAt: f.draft.expiresAt });
    expect(f.raisePending.mock.calls[0]?.[0]).toBe(f.tx);
    const intent = f.raisePending.mock.calls[0]![1];
    expect(intent.params).toMatchObject({ ...exact, sourceSha: preview.sourceSha, leaseId: preview.leaseId, subject: principal,
      authority: { bindingRef: fixture.snapshot.authority.bindingRef, permitRef, grantKeys: fixture.snapshot.authority.grantKeys },
      syntheticTarget: fixture.snapshot.syntheticTarget, approverPrincipalId, attemptLimit: 1, requestLimit: 1, deadlineMs: 120_000 });
    expect(intent.binding).toMatchObject({ actingHumanUserId: actor, inputFingerprint: fingerprintCoworkerInput(intent.params) });
    expect(f.persistPermit).not.toHaveBeenCalled();
    expect(await f.commit(f.envelope(), actor, f.approve)).toEqual({ ok: true });
    expect(f.approve).toHaveBeenCalledExactlyOnceWith(f.tx);
    const [, permit, signature] = f.persistPermit.mock.calls[0]!;
    expect(permit).toMatchObject({ permitId: permitRef, envelopeId: "env-a", authorityDecisionId: "AUTH-A", enforcement: "enforced",
      stageKey: exact.stageKey, shapeRef: fixture.shapeRef, subjectScope: exact.stageAttemptRef, actorGaid: principal.gaid, actorUserId: taskUserId,
      maxUses: 1, expiresAt: new Date(f.draft.expiresAt) });
    expect(signature).toEqual(signPermit(permit, signingOptions));
    expect(f.rows.size).toBe(2);
    expect(await f.commit(f.envelope(), actor, f.approve)).toBeNull();
    expect(f.persistPermit).toHaveBeenCalledOnce();
  });

  it("replays the exact receipt without reserving another permit or raising a second Inbox request", async () => {
    const f = setup();
    const first = await f.producer(actor, f.request);
    expect(first.kind).toBe("proposed");
    expect(await f.producer(actor, f.request)).toEqual(first);
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.raisePending).toHaveBeenCalledOnce();
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("cannot use a newly reviewed digest to issue a second request for the same attempt", async () => {
    const f = setup();
    expect((await f.producer(actor, f.request)).kind).toBe("proposed");
    const changed = { ...f.draft, snapshot: { ...f.draft.snapshot, receiverRef: "control-B" } };
    f.loadCurrent.mockResolvedValueOnce({ ...f.current, draft: changed });
    expect(await f.producer(actor, { ...f.request, reviewedPinDigest: s5RehearsalDraftDigest(changed) })).toEqual({ kind: "held" });
    expect(f.raisePending).toHaveBeenCalledOnce();
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("holds for any changed pin, foreign user, unknown request fields or original deadline equality", async () => {
    const f = setup();
    expect(await f.producer("another-user", f.request)).toEqual({ kind: "held" });
    for (const change of [{ stageAttemptRef: "foreign" }, { reviewedPinDigest: "b".repeat(64) }, { permitRef }, { approvalStatus: "approved" }]) {
      expect(await f.producer(actor, { ...f.request, ...change })).toEqual({ kind: "held" });
    }
    const altered = reviewedS5RehearsalPins.parse({ ...f.draft,
      snapshot: { ...f.draft.snapshot, syntheticTarget: { ...f.draft.snapshot.syntheticTarget, destinationRef: "other-target" } } });
    f.loadCurrent.mockResolvedValueOnce({ ...f.current, draft: altered });
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    f.now.mockReturnValue(new Date(f.draft.expiresAt));
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    expect(f.raisePending).not.toHaveBeenCalled();
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("does not raise an approval for the task actor or a substituted approver", async () => {
    const f = setup();
    f.loadCurrent.mockResolvedValueOnce({ ...f.current, approverUserId: taskUserId });
    expect(await f.producer(taskUserId, f.request)).toEqual({ kind: "held" });
    f.loadCurrent.mockResolvedValueOnce({ ...f.current, approverPrincipalId: "PRN-SUBSTITUTE" });
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    expect(f.raisePending).not.toHaveBeenCalled();
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("cannot use a copied envelope, substituted shape, operations or extended deadline to issue a permit", async () => {
    const f = setup();
    expect((await f.producer(actor, f.request)).kind).toBe("proposed");
    expect(await f.commit({ ...f.envelope(), id: "copied-envelope" }, actor, f.approve)).toBeNull();
    for (const variant of [{ shapeRef: "other" }, { operations: ["get_workroom"] as const }, { expiresAt: t + 110_000 }]) {
      const draft = reviewedS5RehearsalPins.parse({ ...f.draft, ...variant });
      f.loadCurrent.mockResolvedValueOnce({ ...f.current, draft });
      f.readDecision.mockResolvedValue({ ...f.approvalIntent, reviewedPinDigest: s5RehearsalDraftDigest(draft) });
      expect(await f.commit(f.envelope(), actor, f.approve)).toBeNull();
    }
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("burns the attempt at original deadline equality even if the request was never approved", async () => {
    const f = setup();
    expect((await f.producer(actor, f.request)).kind).toBe("proposed");
    f.now.mockReturnValue(new Date(f.draft.expiresAt));
    expect(await f.commit(f.envelope(), actor, f.approve)).toBeNull();
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("refuses an approved envelope from a helper and refuses a shadow or unsigned permit before any approval receipt", async () => {
    const f = setup();
    f.raisePending.mockResolvedValueOnce({ envelopeId: "env-a", status: "approved", expiresAt: new Date(f.draft.expiresAt), authorityDecisionId: "AUTH-A" });
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    expect(f.persistPermit).not.toHaveBeenCalled();
    expect((await f.producer(actor, f.request)).kind).toBe("proposed");
    const envelope = f.envelope();
    f.persistPermit.mockImplementationOnce(async (_tx, claims, signature) => ({
      ...claims, enforcement: "shadow", keyId: signature.keyId, mac: signature.mac, useCount: 0, revokedAt: null, id: "shadow",
    }));
    expect(await f.commit(envelope, actor, f.approve)).toBeNull();
    f.persistPermit.mockImplementationOnce(async (_tx, claims) => ({
      ...claims, keyId: null, mac: null, useCount: 0, revokedAt: null, id: "unsigned",
    }));
    expect(await f.commit(envelope, actor, f.approve)).toBeNull();
    expect(f.rows.size).toBe(1); // Only the original proposal.
  });

  it("uses the canonical envelope writer without writing or reserving an approved row", async () => {
    const f = setup();
    await f.producer(actor, f.request);
    const intent = f.raisePending.mock.calls[0]![1];
    const stored = {
      id: "env-a", status: "proposed", resolvedAt: null, expiresAt: intent.deadline,
      authorityDecisionId: "AUTH-A", inputFingerprint: intent.binding.inputFingerprint,
      manifestActionId: intent.binding.toolName, delegatingUserId: actor, coworkerAgentId: intent.binding.actingAgentId,
    };
    const db = { ...f.tx, workroom: { findUnique: vi.fn() },
      agentThread: { upsert: vi.fn().mockResolvedValue({ id: "thread-exact" }) },
      taskRun: { updateMany: vi.fn() },
      authorizationDecisionLog: { create: vi.fn().mockResolvedValue({ decisionId: "AUTH-A" }) },
      coworkerActionEnvelope: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(stored),
        create: vi.fn().mockResolvedValue(stored), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const canonical = s5RehearsalPreviewOwnerPorts(db as unknown as Parameters<typeof s5RehearsalPreviewOwnerPorts>[0]);
    expect(await canonical.raisePending(db, intent)).toMatchObject({ envelopeId: "env-a", status: "proposed" });
    const written = db.coworkerActionEnvelope.create.mock.calls[0]?.[0]?.data;
    expect(written).toMatchObject({ manifestActionId: intent.binding.toolName, authorityDecisionId: "AUTH-A",
      inputFingerprint: intent.binding.inputFingerprint, argsJson: { proposeBoundary: true }, taskRunId: null, expiresAt: intent.deadline });
    expect(written.status).toBeUndefined(); // Prisma's canonical default is proposed.
    expect(written.argsJson.humanApproval).toBeUndefined();
    expect(written.rationale).toContain(`Work shape: ${f.draft.shapeRef}`);
    expect(written.rationale).toContain("post_room_message (write: record a quiet route proposal only)");
    expect(written.rationale).toContain(new Date(f.draft.expiresAt).toISOString());
    expect(written.rationale).toContain("cannot be reopened");
    expect(db.coworkerActionEnvelope.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: { status: "expired", resolvedAt: intent.now } }));
    expect(db.taskRun.updateMany).not.toHaveBeenCalled();
  });
});
