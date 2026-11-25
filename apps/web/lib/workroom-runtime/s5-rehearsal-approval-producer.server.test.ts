import { describe, expect, it, vi } from "vitest";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { signPermit, verifyPermitMac } from "@/lib/gpp/permit-handle";
import type { ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { createS5RehearsalApprovalProducer, reviewedS5RehearsalPins, s5RehearsalDraftDigest, s5RehearsalPreviewOwnerPorts,
  type S5RehearsalProducerPorts } from "./s5-rehearsal-approval-producer.server";

const t = 1_795_560_000_000;
const preview = { leaseId: "NPEL-FIXTURE", sourceSha: "a".repeat(40), origin: "http://localhost:3001" };
const exact = { workroomId: "WC-FIXTURE", sessionRef: "run-fixture", stageKey: "coordinate", stageAttemptRef: "attempt-1" };
const actor = "reviewing-owner";
const principal = { principalId: "PRN-AGENT", gaid: "gaid:priv:fixture:agent" };
const fixture = {
  schemaVersion: "s5-rehearsal-approval-draft.v1", leaseId: preview.leaseId, sourceSha: preview.sourceSha,
  signingPublicKey: Buffer.alloc(44).toString("base64"), shapeRef: "shape@1",
  expiresAt: t + 100_000, operations: ["get_workroom", "post_room_message"],
  snapshot: { ...exact, profile: "synthetic-rehearsal", mode: "read-only-coordination",
    issuer: "source-A", receiverRef: "control-A", hostRef: "host-A", resource: preview.origin + "/api/internal/s5-rehearsal-admission",
    originRef: "origin-A", subject: principal, authority: { bindingRef: "binding-A", grantKeys: ["room_read", "room_write"] },
    syntheticTarget: { environment: "non-production", fixtureRef: "fixture-a", databaseRef: "preview-db:NPEL-FIXTURE",
      caseKey: "case-a", destinationRef: "relay-a", recipient: { authorityRef: "auth-a", destinationRef: "dest-a", reservationRef: "res-a" } },
  },
};
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
  const loadCurrent = vi.fn<S5RehearsalProducerPorts["loadCurrent"]>().mockResolvedValue({ draft, userId: actor, agentId: "AGT-FIXTURE", bindingRowId: "binding-row" });
  const raisePending = vi.fn<S5RehearsalProducerPorts["raisePending"]>().mockResolvedValue({ envelopeId: "env-a", status: "proposed", expiresAt: new Date(draft.expiresAt), authorityDecisionId: "AUTH-A" });
  const persistPermit = vi.fn<S5RehearsalProducerPorts["persistPermit"]>().mockImplementation(async (_tx, claims, signature) => ({
    ...claims, keyId: signature.keyId, mac: signature.mac, useCount: 0, revokedAt: null, id: "permit-row",
  }));
  const now = vi.fn(() => new Date(t));
  const reserve = vi.fn(() => permitRef);
  const producer = createS5RehearsalApprovalProducer({ db, preview, now, locateRoom: async () => "room-row",
    loadCurrent, raisePending, persistPermit, reservePermitRef: reserve, nonce: () => "nonce", sign: p => signPermit(p, signingOptions),
    verify: p => verifyPermitMac(p, null, signingOptions).result === "ok" });
  return { producer, draft, request, loadCurrent, raisePending, persistPermit, reserve, now, rows, tx };
}

describe("S5 preview-only approval producer", () => {
  it("binds the reserved enforced permit to exactly one proposed canonical approval and the reviewed pins", async () => {
    const f = setup();
    expect(await f.producer(actor, f.request)).toEqual({ kind: "proposed", envelopeId: "env-a", permitRef, expiresAt: f.draft.expiresAt });
    expect(f.raisePending.mock.calls[0]?.[0]).toBe(f.tx);
    const intent = f.raisePending.mock.calls[0]![1];
    expect(intent.params).toMatchObject({ ...exact, sourceSha: preview.sourceSha, leaseId: preview.leaseId, subject: principal,
      authority: { bindingRef: fixture.snapshot.authority.bindingRef, permitRef, grantKeys: fixture.snapshot.authority.grantKeys },
      syntheticTarget: fixture.snapshot.syntheticTarget, attemptLimit: 1, requestLimit: 1, deadlineMs: 120_000 });
    expect(intent.binding.inputFingerprint).toBe(fingerprintCoworkerInput(intent.params));
    const [, permit, signature] = f.persistPermit.mock.calls[0]!;
    expect(permit).toMatchObject({ permitId: permitRef, envelopeId: "env-a", authorityDecisionId: "AUTH-A", enforcement: "enforced",
      stageKey: exact.stageKey, shapeRef: fixture.shapeRef, subjectScope: exact.stageAttemptRef, actorGaid: principal.gaid,
      maxUses: 1, expiresAt: new Date(f.draft.expiresAt) });
    expect(signature).toEqual(signPermit(permit, signingOptions));
    expect(f.rows.size).toBe(1);
  });

  it("replays the exact receipt without reserving another permit or raising a second Inbox request", async () => {
    const f = setup();
    const first = await f.producer(actor, f.request);
    expect(first.kind).toBe("proposed");
    expect(await f.producer(actor, f.request)).toEqual(first);
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.raisePending).toHaveBeenCalledOnce();
    expect(f.persistPermit).toHaveBeenCalledOnce();
  });

  it("cannot use a newly reviewed digest to issue a second request for the same attempt", async () => {
    const f = setup();
    expect((await f.producer(actor, f.request)).kind).toBe("proposed");
    const changed = { ...f.draft, snapshot: { ...f.draft.snapshot, receiverRef: "control-B" } };
    f.loadCurrent.mockResolvedValueOnce({ draft: changed, userId: actor, agentId: "AGT-FIXTURE", bindingRowId: "binding-row" });
    expect(await f.producer(actor, { ...f.request, reviewedPinDigest: s5RehearsalDraftDigest(changed) })).toEqual({ kind: "held" });
    expect(f.raisePending).toHaveBeenCalledOnce();
    expect(f.persistPermit).toHaveBeenCalledOnce();
  });

  it("holds for any changed pin, foreign user, unknown request fields or original deadline equality", async () => {
    const f = setup();
    expect(await f.producer("another-user", f.request)).toEqual({ kind: "held" });
    for (const change of [{ stageAttemptRef: "foreign" }, { reviewedPinDigest: "b".repeat(64) }, { permitRef }, { approvalStatus: "approved" }]) {
      expect(await f.producer(actor, { ...f.request, ...change })).toEqual({ kind: "held" });
    }
    const altered = reviewedS5RehearsalPins.parse({ ...f.draft,
      snapshot: { ...f.draft.snapshot, syntheticTarget: { ...f.draft.snapshot.syntheticTarget, destinationRef: "other-target" } } });
    f.loadCurrent.mockResolvedValueOnce({ draft: altered, userId: actor, agentId: "AGT-FIXTURE", bindingRowId: "binding-row" });
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    f.now.mockReturnValue(new Date(f.draft.expiresAt));
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    expect(f.raisePending).not.toHaveBeenCalled();
    expect(f.persistPermit).not.toHaveBeenCalled();
  });

  it("refuses an approved envelope from a helper and refuses a shadow or unsigned returned permit before any success receipt", async () => {
    const f = setup();
    f.raisePending.mockResolvedValueOnce({ envelopeId: "env-a", status: "approved", expiresAt: new Date(f.draft.expiresAt), authorityDecisionId: "AUTH-A" });
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    expect(f.persistPermit).not.toHaveBeenCalled();
    f.persistPermit.mockImplementationOnce(async (_tx, claims, signature) => ({
      ...claims, enforcement: "shadow", keyId: signature.keyId, mac: signature.mac, useCount: 0, revokedAt: null, id: "shadow",
    }));
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    f.persistPermit.mockImplementationOnce(async (_tx, claims) => ({
      ...claims, keyId: null, mac: null, useCount: 0, revokedAt: null, id: "unsigned",
    }));
    expect(await f.producer(actor, f.request)).toEqual({ kind: "held" });
    expect(f.rows.size).toBe(0);
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
    expect(db.coworkerActionEnvelope.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: { status: "expired", resolvedAt: intent.now } }));
    expect(db.taskRun.updateMany).not.toHaveBeenCalled();
  });
});
