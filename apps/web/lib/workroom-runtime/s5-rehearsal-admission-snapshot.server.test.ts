import { describe, expect, it, vi } from "vitest";
import { createS5RehearsalAdmissionReader, type S5RehearsalAdmissionReadPorts } from "./s5-rehearsal-admission-snapshot.server";

const start = 1_795_560_000_000;
const locator = { workroomId: "WC-FIXTURE", sessionRef: "session-a", stageKey: "coordinate", stageAttemptRef: "attempt-a" };
const control = { issuer: "fixture-install", receiverRef: "fixture-control", hostRef: "fixture-host", resource: "https://fixture.invalid/s5" };
const pin = {
  ...locator, ...control, originRef: "origin:fixture", mode: "read-only-coordination", profile: "synthetic-rehearsal",
  subject: { principalId: "PRN-FIXTURE", gaid: "gaid:priv:fixture:agent" },
  authority: { bindingRef: "binding-a", permitRef: "permit-a", grantKeys: ["work_room_read", "work_room_write"] },
  qualification: { kind: "rehearsal-qualification", approvalRef: "approval-a", ownerPrincipalId: "PRN-OWNER",
    statusRevision: 3, approvalRevision: 2, validUntil: start + 150_000 },
  expiresAt: start + 120_000,
  syntheticTarget: { environment: "non-production", fixtureRef: "fixture-a", databaseRef: "db-fixture-a", caseKey: "backlog-item:BI-FIXTURE",
    destinationRef: "guest-fixture-a", recipient: { authorityRef: "recipient-auth-a", destinationRef: "recipient-destination-a", reservationRef: "recipient-reservation-a" } },
};
const request = new Request(control.resource, { method: "POST" });

function fixture() {
  // Both ports are test doubles. No persisted owner adapter is registered.
  const authenticate = vi.fn<S5RehearsalAdmissionReadPorts["authenticate"]>().mockResolvedValue(control);
  const evidence = { active: true, pinned: pin, current: structuredClone(pin) };
  const readEvidence = vi.fn<S5RehearsalAdmissionReadPorts["readEvidence"]>().mockResolvedValue(evidence);
  const now = vi.fn(() => new Date(start));
  const read = createS5RehearsalAdmissionReader({ authenticate, readEvidence, now });
  return { read, authenticate, readEvidence, evidence, now };
}

describe("exact S5 rehearsal admission evidence, no writes or send", () => {
  it("projects only read-only evidence for the authenticated watcher of the exact live attempt", async () => {
    const f = fixture();
    await expect(f.read(request, locator)).resolves.toEqual({ kind: "observed", snapshot: pin });
    expect(f.readEvidence).toHaveBeenCalledExactlyOnceWith(control, locator);
    expect(Object.keys(f.evidence)).toEqual(["active", "pinned", "current"]);
  });

  it("refuses unauthenticated lookup and any caller-supplied subject or deadline", async () => {
    const f = fixture();
    f.authenticate.mockResolvedValueOnce(null);
    expect(await f.read(request, locator)).toEqual({ kind: "held" });
    expect(await f.read(request, { ...locator, subject: pin.subject, expiresAt: pin.expiresAt })).toEqual({ kind: "held" });
    expect(f.readEvidence).not.toHaveBeenCalled();
  });

  it.each([
    { ...locator, stageAttemptRef: "past" }, { ...locator, stageKey: "wrong-stage" }, { ...locator, workroomId: "WC-OTHER" },
  ])("refuses a different exact locator", async (changed) => {
    const f = fixture();
    expect(await f.read(request, changed)).toEqual({ kind: "held" });
  });

  it("refuses a replaced attempt or cross-Control read", async () => {
    const f = fixture();
    f.readEvidence.mockResolvedValueOnce({ ...f.evidence, active: false });
    expect(await f.read(request, locator)).toEqual({ kind: "held" });
    f.authenticate.mockResolvedValueOnce({ ...control, receiverRef: "other" });
    expect(await f.read(request, locator)).toEqual({ kind: "held" });
  });

  it.each([
    { qualification: null }, { qualification: { ...pin.qualification, statusRevision: 4 } },
    { qualification: { ...pin.qualification, approvalRevision: 3 } },
    { qualification: { kind: "eligible", id: "canonical-jsi", version: 1, statusRevision: 3, validUntil: start + 150_000 } },
    { qualification: { ...pin.qualification, validUntil: start } },
    { subject: { ...pin.subject, gaid: "gaid:priv:fixture:other" } },
    { syntheticTarget: { ...pin.syntheticTarget, databaseRef: "other-db" } },
    { syntheticTarget: { ...pin.syntheticTarget, destinationRef: "foreign-target" } },
    { syntheticTarget: { ...pin.syntheticTarget, environment: "production" } },
    { tokenId: "forbidden" }, { s6Floor: 4 },
  ])("holds missing, changed or unpublishable owner facts", async (changes) => {
    const f = fixture();
    f.readEvidence.mockResolvedValue({ ...f.evidence, current: { ...pin, ...changes } });
    expect(await f.read(request, locator)).toEqual({ kind: "held" });
  });

  it("uses DPF time after the read and holds at equality without extending the original deadline", async () => {
    const f = fixture();
    f.readEvidence.mockImplementationOnce(async () => {
      f.now.mockReturnValue(new Date(pin.expiresAt));
      return f.evidence;
    });
    expect(await f.read(request, locator)).toEqual({ kind: "held" });
    f.now.mockReturnValue(new Date(start));
    f.readEvidence.mockResolvedValueOnce({ ...f.evidence, current: { ...pin, expiresAt: pin.expiresAt + 1 } });
    expect(await f.read(request, locator)).toEqual({ kind: "held" });
  });
});
