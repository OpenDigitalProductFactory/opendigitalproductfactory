import { describe, expect, it, vi } from "vitest";
import type { JsiQualificationSources } from "@/lib/work-management/coordinator-eligibility";
import {
  createS5AdmissionComposer,
  type S5AdmissionPorts,
  type S5AssignmentSnapshot,
} from "./s5-admission.server";

const locator = { workroomId: "WC-SYNTHETIC", sessionRef: "session-a", stageAttemptRef: "attempt-2" };
const subject = { principalId: "PRN-SYNTHETIC", gaid: "gaid:priv:fixture:engineer" };
const now = new Date("2026-11-25T00:00:00Z");
const t = now.getTime();
const coordinationActivity = "s5-route-handoff";
const ops = ["get_workroom", "read_room_messages", "post_room_message", "read_project_file", "propose_file_change"];
const scope = { workflow: "engineering", archetype: "fixture", jurisdiction: "US", dataClass: "synthetic", riskClass: "low" };
const scheme = { id: "qualification-scheme", version: "1" };
const assessment = { id: "assessment-a", version: "1", digest: `sha256:${"b".repeat(64)}` };

function fixture(): S5AssignmentSnapshot {
  return {
    ...locator,
    stageKey: "working",
    caseKey: "backlog-item:BI-SYNTHETIC",
    shapeRef: "fixture-shape",
    admittedPrincipalId: subject.principalId,
    agentId: "AGT-SYNTHETIC",
    activity: {
      organizationId: "org-fixture", installationId: "install-fixture", job: { id: "engineering", version: "1" },
      activityKey: "coding-fixture", scope, profileFingerprint: `sha256:${"a".repeat(64)}`,
    },
    authority: {
      principalId: subject.principalId, bindingRef: "binding-a", authorityBindingId: "binding-row-a", status: "active", scopeType: "workroom",
      resourceType: "work-shape", resourceRef: "fixture-shape", permitRef: "permit-a", grantKeys: ["file_read"],
      operationKeys: ops,
    },
    host: { hostRef: "host-a", receiverRef: "receiver-a", worktreeRef: "worktree-a", mode: "bounded-coding", operationKeys: ops },
    jobOperationKeys: ops,
    stageOperationKeys: ops,
    liveOperationKeys: ops,
  };
}

function sources(snapshot: S5AssignmentSnapshot, overrides: Partial<JsiQualificationSources> = {}, resolvedSubject = subject): JsiQualificationSources {
  const selector = { ...snapshot.activity, subject: resolvedSubject, scheme };
  const issuer = "PRN-ISSUER";
  const assessor = "PRN-ASSESSOR";
  return {
    readActivityPolicy: vi.fn().mockResolvedValue({ kind: "required", scheme }),
    readCurrentCandidates: vi.fn().mockResolvedValue([{
      id: "credential-a", version: 4, statusRevision: 2, status: "active", selector,
      ceiling: { operationKeys: ops, excludedOperationKeys: [], oversight: "review-before-effect" },
      assessment, issuerPrincipalId: issuer, assessorPrincipalId: assessor,
      issuedAt: t - 2_000, validFrom: t - 1_000, expiresAt: t + 120_000, reviewDueAt: t + 60_000,
    }]),
    readVerifiedAssessment: vi.fn().mockResolvedValue({
      assessment, selector, verdict: "pass", criticalFailure: false, assessorPrincipalId: assessor,
      assessedAt: t - 3_000, validUntil: t + 90_000,
    }),
    ...overrides,
  };
}

function ports(snapshot = fixture(), overrides: Partial<S5AdmissionPorts> = {}): S5AdmissionPorts {
  return {
    readCurrentAssignment: vi.fn().mockResolvedValue(snapshot),
    readAdmittedSubject: vi.fn().mockResolvedValue(subject),
    qualificationSources: sources(snapshot),
    getRegistryAccess: (name) => {
      if (name === "read_project_file") return "source-read";
      if (name === "propose_file_change") return "source-edit";
      return ops.includes(name) ? "room-operation" : undefined;
    },
    confirmCurrent: vi.fn().mockResolvedValue(true),
    now: () => now,
    ...overrides,
  };
}

describe("S5 admission composition", () => {
  it("intersects the assigned job, stage, current authority, JSI and mode for two jobs in one stage", async () => {
    const engineer = { ...fixture(), jobOperationKeys: ["read_project_file", "propose_file_change"], liveOperationKeys: ["read_project_file"] };
    const other = { principalId: "PRN-OTHER-SYNTHETIC", gaid: "gaid:priv:fixture:coordinator" };
    const otherLocator = { ...locator, sessionRef: "session-b", stageAttemptRef: "attempt-other" };
    const coordinator = { ...fixture(), ...otherLocator, admittedPrincipalId: other.principalId, agentId: "AGT-OTHER-SYNTHETIC",
      authority: { ...fixture().authority!, principalId: other.principalId, bindingRef: "binding-b", authorityBindingId: "binding-row-b" },
      activity: { ...fixture().activity, activityKey: coordinationActivity, job: { id: "coordination", version: "2" } },
      host: { ...fixture().host!, mode: "read-only-coordination" as const, worktreeRef: null },
      jobOperationKeys: ["get_workroom", "post_room_message", "propose_file_change", "unknown__write"],
      stageOperationKeys: ["get_workroom", "propose_file_change", "unknown__write"],
    };
    const one = ports(engineer);
    const two = ports(coordinator, { qualificationSources: sources(coordinator, {}, other), readAdmittedSubject: vi.fn().mockResolvedValue(other) });
    await expect(createS5AdmissionComposer(one)(locator)).resolves.toMatchObject({ kind: "composed", subject, operationKeys: ["read_project_file"] });
    await expect(createS5AdmissionComposer(two)(otherLocator)).resolves.toMatchObject({ kind: "composed", subject: other, operationKeys: ["get_workroom"] });
    expect(one.qualificationSources!.readCurrentCandidates).toHaveBeenCalledWith(expect.objectContaining({ subject }), expect.any(AbortSignal));
    expect(two.qualificationSources!.readCurrentCandidates).toHaveBeenCalledWith(expect.objectContaining({ subject: other }), expect.any(AbortSignal));
  });

  it.each([
    { readAdmittedSubject: undefined }, { readAdmittedSubject: vi.fn().mockResolvedValue(null) },
    { readAdmittedSubject: vi.fn().mockResolvedValue({ ...subject, principalId: "PRN-OTHER" }) },
    { readAdmittedSubject: vi.fn().mockResolvedValue({ ...subject, gaid: "" }) },
  ])("holds before reading qualification when identity is unsupported or mismatched", async (overrides) => {
    const p = ports(fixture(), overrides);
    await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "subject-unavailable" });
    expect(p.qualificationSources!.readActivityPolicy).not.toHaveBeenCalled();
  });

  it.each(["principal", "shape", "status"])("does not use an authority binding on the wrong %s", async (change) => {
    const s = fixture();
    s.authority = { ...s.authority!, ...(change === "principal" ? { principalId: "PRN-OTHER" } : change === "shape" ? { resourceRef: "wrong-shape" } : { status: "suspended" }) };
    await expect(createS5AdmissionComposer(ports(s))(locator)).resolves.toMatchObject({ kind: "held", reason: "binding-unavailable" });
  });

  it("does not replace an unavailable or incompatible JSI verdict with not applicable", async () => {
    const s = fixture();
    const noScheme = sources(s, { readActivityPolicy: vi.fn().mockResolvedValue({ kind: "not-applicable" }) });
    await expect(createS5AdmissionComposer(ports(s, { qualificationSources: noScheme }))(locator)).resolves.toMatchObject({ kind: "composed", jsi: { kind: "not-applicable" } });
    const missing = sources(s, { readCurrentCandidates: vi.fn().mockResolvedValue([]) });
    await expect(createS5AdmissionComposer(ports(s, { qualificationSources: missing }))(locator)).resolves.toMatchObject({ kind: "held", reason: "qualification-unavailable" });
    const incompatible = sources(s, { readVerifiedAssessment: vi.fn().mockResolvedValue({}) });
    await expect(createS5AdmissionComposer(ports(s, { qualificationSources: incompatible }))(locator)).resolves.toMatchObject({ kind: "held", reason: "qualification-unavailable" });
  });

  it("keeps coordination pilot eligible-only", async () => {
    const s = fixture();
    s.activity.activityKey = coordinationActivity;
    s.host = { ...s.host!, mode: "read-only-coordination", worktreeRef: null };
    const noScheme = sources(s, { readActivityPolicy: vi.fn().mockResolvedValue({ kind: "not-applicable" }) });
    await expect(createS5AdmissionComposer(ports(s, { qualificationSources: noScheme }))(locator)).resolves.toMatchObject({ kind: "held", reason: "qualification-unavailable" });
  });

  describe("owner-approved synthetic rehearsal", () => {
    const syntheticTarget = {
      environment: "non-production" as const, fixtureRef: "fixture-a", databaseRef: "fixture-db",
      caseKey: fixture().caseKey, destinationRef: "nonprod-relay",
      recipient: { authorityRef: "recipient-a", destinationRef: "recipient-destination-a", reservationRef: "reservation-a" },
    };
    const binding = { ...locator, issuer: fixture().activity.installationId, stageKey: fixture().stageKey,
      subject, syntheticTarget };
    const record = { schemaVersion: "s5-rehearsal-qualification.v1", status: "active",
      approvalRef: "approval-a", ownerPrincipalId: "PRN-OWNER", statusRevision: 2,
      binding, issuedAt: t - 1, validUntil: t + 30_000 };
    const approval = { purpose: "s5-single-synthetic-rehearsal", status: "approved",
      ref: record.approvalRef, ownerPrincipalId: record.ownerPrincipalId, revision: 3, binding, validUntil: t + 20_000 };

    function rehearsal(): S5AssignmentSnapshot {
      const s = fixture();
      return { ...s, executionProfile: "synthetic-rehearsal", syntheticTarget,
        activity: { ...s.activity, activityKey: coordinationActivity },
        host: { ...s.host!, mode: "read-only-coordination", worktreeRef: null } };
    }

    it("accepts only the exact owner record, not as JSI, and still intersects live authority", async () => {
      const p = ports({ ...rehearsal(), liveOperationKeys: ["get_workroom", "propose_file_change"] }, {
        qualificationSources: undefined, readRehearsalQualification: vi.fn().mockResolvedValue({ record, approval }),
      });
      await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({
        kind: "composed", jsi: { kind: "rehearsal-qualification", approvalRef: "approval-a", ownerPrincipalId: "PRN-OWNER",
          statusRevision: 2, approvalRevision: 3, validUntil: t + 20_000, syntheticTarget },
        operationKeys: ["get_workroom"],
      });
      expect(p.confirmCurrent).toHaveBeenCalledWith(expect.objectContaining({
        qualification: null, rehearsalQualification: expect.objectContaining({ approvalRef: "approval-a" }),
      }));
    });

    it.each([undefined, "v1", "production", "unrecognized"])("never substitutes the record under profile %s", async (profile) => {
      // Also exercise an untyped/unknown owner profile at the runtime boundary.
      const s = { ...rehearsal(), executionProfile: profile as S5AssignmentSnapshot["executionProfile"] };
      const p = ports(s, { qualificationSources: undefined, readRehearsalQualification: vi.fn().mockResolvedValue({ record, approval }) });
      await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held" });
      expect(p.readRehearsalQualification).not.toHaveBeenCalled();
    });

    it("requires canonical eligible JSI for a production assignment", async () => {
      const s = { ...fixture(), executionProfile: "production" as const };
      const noScheme = sources(s, { readActivityPolicy: vi.fn().mockResolvedValue({ kind: "not-applicable" }) });
      const readRehearsalQualification = vi.fn().mockResolvedValue({ record, approval });
      const p = ports(s, { qualificationSources: noScheme, readRehearsalQualification });
      await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "qualification-unavailable" });
      await expect(createS5AdmissionComposer(ports(s))(locator)).resolves.toMatchObject({ kind: "composed", jsi: { kind: "eligible" } });
      expect(readRehearsalQualification).not.toHaveBeenCalled();
    });

    it.each([
      ["no record", null, approval], ["no approval", record, null],
      ["fixture only", { ...record, approvalRef: "" }, { ...approval, ref: "" }],
      ["revoked record", { ...record, status: "revoked" }, approval],
      ["pending approval", record, { ...approval, status: "pending" }],
      ["revoked approval", record, { ...approval, status: "revoked" }],
      ["wrong approval", record, { ...approval, ref: "different" }],
      ["wrong owner", record, { ...approval, ownerPrincipalId: "PRN-NOT-OWNER" }],
      ["different approval purpose", record, { ...approval, purpose: "s5-other-action" }],
      ["expired approval", record, { ...approval, validUntil: t }],
      ["expired record", { ...record, validUntil: t }, approval],
      ["other attempt", { ...record, binding: { ...binding, stageAttemptRef: "another" } }, approval],
      ["other GAID", { ...record, binding: { ...binding, subject: { ...subject, gaid: "gaid:priv:fixture:wrong" } } }, approval],
      ["other database", record, { ...approval, binding: { ...binding, syntheticTarget: { ...syntheticTarget, databaseRef: "live-db" } } }],
      ["other destination", record, { ...approval, binding: { ...binding, syntheticTarget: { ...syntheticTarget, destinationRef: "other" } } }],
    ])("holds %s even when canonical sources exist", async (_reason, record, approval) => {
      const p = ports(rehearsal(), { readRehearsalQualification: vi.fn().mockResolvedValue({ record, approval }) });
      await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "qualification-unavailable" });
      expect(p.qualificationSources!.readActivityPolicy).not.toHaveBeenCalled();
    });

    it("holds non-synthetic data, non-coordination assignments and a failed current-owner check", async () => {
      const s = rehearsal();
      const readRehearsalQualification = vi.fn().mockResolvedValue({ record, approval });
      const actualData = { ...s, activity: { ...s.activity, scope: { ...scope, dataClass: "customer" } } };
      await expect(createS5AdmissionComposer(ports(actualData, { readRehearsalQualification }))(locator)).resolves.toMatchObject({ kind: "held" });
      await expect(createS5AdmissionComposer(ports({ ...fixture(), executionProfile: "synthetic-rehearsal", syntheticTarget }, { readRehearsalQualification }))(locator)).resolves.toMatchObject({ kind: "held" });
      expect(readRehearsalQualification).not.toHaveBeenCalled();
      const p = ports(s, { readRehearsalQualification, confirmCurrent: vi.fn().mockResolvedValue(false) });
      await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "admission-changed" });
    });

    it("rechecks the original approval expiry at equality after current-owner confirmation", async () => {
      const clock = vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(new Date(approval.validUntil));
      const p = ports(rehearsal(), { readRehearsalQualification: vi.fn().mockResolvedValue({ record, approval }), now: clock });
      await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "admission-changed" });
    });
  });

  it("holds if the stage attempt or pinned host is missing and never confirms an old attempt", async () => {
    const p = ports({ ...fixture(), stageAttemptRef: "attempt-1" });
    await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "assignment-unavailable" });
    expect(p.confirmCurrent).not.toHaveBeenCalled();
    await expect(createS5AdmissionComposer(ports({ ...fixture(), host: null }))(locator)).resolves.toMatchObject({ kind: "held", reason: "host-unavailable" });
  });

  it("holds when the issuing ports cannot prove the same binding and qualification are still current", async () => {
    const p = ports(fixture(), { confirmCurrent: vi.fn().mockResolvedValue(false) });
    await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "admission-changed" });
    expect(p.confirmCurrent).toHaveBeenCalledWith(expect.objectContaining({
      locator, subject, qualification: { id: "credential-a", version: 4, statusRevision: 2 },
      snapshot: expect.objectContaining({ authority: expect.objectContaining({ bindingRef: "binding-a", permitRef: "permit-a" }) }),
    }));
  });

  it("narrows forwarding and never restores unissued or alias operation names", async () => {
    const p = ports({ ...fixture(), jobOperationKeys: ["get_workroom", "read_project_file", "get_work_capsule"] });
    await expect(createS5AdmissionComposer(p)(locator, ["get_workroom", "get_work_capsule", "post_room_message"])).resolves.toMatchObject({ kind: "composed", operationKeys: ["get_workroom"] });
  });

  it("refuses an expired qualification even if the owner probe completed successfully", async () => {
    const clock = vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(new Date(t + 60_000));
    await expect(createS5AdmissionComposer(ports(fixture(), { now: clock }))(locator)).resolves.toMatchObject({ kind: "held", reason: "admission-changed" });
  });

  it("does not compose a ceiling from a failed current authority read", async () => {
    const p = ports(fixture(), { confirmCurrent: vi.fn().mockRejectedValue(new Error("unavailable")) });
    await expect(createS5AdmissionComposer(p)(locator)).resolves.toMatchObject({ kind: "held", reason: "source-unavailable" });
  });
});
