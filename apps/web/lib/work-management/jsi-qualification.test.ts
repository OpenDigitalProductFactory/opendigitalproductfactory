import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { hydrateS5JsiSelector, s5LaunchProjectionSchema } from "@dpf/validators/workroom/s5-launch";
import { describe, expect, it, vi } from "vitest";
import coordinationFixture from "../../../../packages/validators/src/workroom/s5-launch.v1.coordination.fixture.json";
import {
  resolveS5JsiEligibility,
  type JsiAdmissionContext,
  type JsiQualificationRecord,
  type JsiQualificationSources,
} from "./coordinator-eligibility";

const now = new Date("2026-11-25T10:00:00Z");
const t = now.getTime();
const profileFingerprint = "sha256:1f187b3826df13396c8cb345ea263308322aefa97af22c36739f29047e17bd25";
const context = {
  organizationId: "org-fixture",
  installationId: "install-fixture",
  subject: { principalId: "principal-fixture", gaid: "gaid:priv:fixture:reviewer" },
  job: { id: "invoice-review", version: "2" },
  activityKey: "invoice-validation",
  scope: { workflow: "payables", archetype: "finance", jurisdiction: "US", dataClass: "internal", riskClass: "low" },
  profileFingerprint,
  operationKey: "validate-invoice",
} satisfies JsiAdmissionContext;
const { operationKey: _operationKey, ...admission } = context;
const selector = { ...admission, scheme: { id: "review-criteria", version: "3" } };
const assessment = { id: "accepted-assessment", version: "1", digest: "sha256:" + "b".repeat(64) };
const record = {
  id: "qualification-fixture",
  version: 2,
  statusRevision: 4,
  status: "active",
  selector,
  ceiling: {
    operationKeys: ["validate-invoice", "route-exception"],
    excludedOperationKeys: ["release-payment"],
    oversight: "review-before-effect",
  },
  assessment,
  issuerPrincipalId: "human-issuer",
  assessorPrincipalId: "independent-assessor",
  issuedAt: t - 120_000,
  validFrom: t - 60_000,
  expiresAt: t + 120_000,
  reviewDueAt: t + 60_000,
} satisfies JsiQualificationRecord;
const evidence = {
  assessment,
  selector,
  verdict: "pass",
  criticalFailure: false,
  assessorPrincipalId: record.assessorPrincipalId,
  assessedAt: t - 180_000,
  validUntil: t + 90_000,
};

function sources() {
  return {
    readActivityPolicy: vi.fn<JsiQualificationSources["readActivityPolicy"]>()
      .mockResolvedValue({ kind: "required", scheme: selector.scheme }),
    readCurrentCandidates: vi.fn<NonNullable<JsiQualificationSources["readCurrentCandidates"]>>()
      .mockResolvedValue([record]),
    readVerifiedAssessment: vi.fn<NonNullable<JsiQualificationSources["readVerifiedAssessment"]>>()
      .mockResolvedValue(evidence),
  };
}

describe("S5 JSI exact-profile local conformance", () => {
  it("round-trips the coordination projection through the production JSI resolver using synthetic sources", async () => {
    const launch = s5LaunchProjectionSchema.parse(coordinationFixture.launch);
    if (launch.jsi.kind !== "eligible") throw new Error("Expected the pilot's eligible-only launch");
    const exact = hydrateS5JsiSelector({ subject: launch.subject, jsi: launch.jsi });
    const { scheme, ...admission } = exact;
    const deps = sources();
    deps.readActivityPolicy.mockResolvedValue({ kind: "required", scheme });
    deps.readCurrentCandidates.mockResolvedValue([{
      ...record,
      ...launch.jsi.qualification,
      selector: exact,
      ceiling: { ...record.ceiling, operationKeys: launch.permittedOperations },
      expiresAt: launch.jsi.validUntil,
      reviewDueAt: launch.jsi.validUntil,
    }]);
    deps.readVerifiedAssessment.mockResolvedValue({ ...evidence, selector: exact, validUntil: launch.jsi.validUntil });

    expect(await resolveS5JsiEligibility(admission, deps, now)).toMatchObject({
      kind: "eligible", selector: exact, qualification: launch.jsi.qualification, validUntil: launch.jsi.validUntil,
    });
    expect(deps.readCurrentCandidates).toHaveBeenCalledExactlyOnceWith(exact, expect.any(AbortSignal));
    expect(await resolveS5JsiEligibility(admission, deps, new Date(launch.jsi.validUntil)))
      .toEqual({ kind: "stale", reason: "expired" });
  });

  it("uses the pinned UTF-8 digest of the versioned fixture profile", async () => {
    const material = { version: 1, fixture: "invoice-review", model: "fixture-model@1", skills: ["invoice-review@2"] };
    const digest = createHash("sha256").update(canonicalJson(material), "utf8").digest("hex");
    expect("sha256:" + digest).toBe(profileFingerprint);

    const deps = sources();
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "eligible",
      qualification: { id: record.id, version: record.version, statusRevision: record.statusRevision },
      selector,
      ceiling: record.ceiling,
      validUntil: record.reviewDueAt,
    });
    expect(deps.readCurrentCandidates).toHaveBeenCalledExactlyOnceWith(selector, expect.any(AbortSignal));
    expect(deps.readVerifiedAssessment).toHaveBeenCalledExactlyOnceWith(assessment, selector, expect.any(AbortSignal));
  });

  it("returns no ceiling only for an explicit no-scheme policy", async () => {
    const deps = sources();
    deps.readActivityPolicy.mockResolvedValue({ kind: "not-applicable" });
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({ kind: "not-applicable" });
    expect(deps.readActivityPolicy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      organizationId: context.organizationId,
      installationId: context.installationId,
      subject: context.subject,
      job: context.job,
      activityKey: context.activityKey,
      scope: context.scope,
    }), expect.any(AbortSignal));
    expect(deps.readCurrentCandidates).not.toHaveBeenCalled();
    expect(deps.readVerifiedAssessment).not.toHaveBeenCalled();
  });

  it("resolves the launch ceiling without inventing an invocation operation", async () => {
    expect(await resolveS5JsiEligibility(admission, sources(), now)).toMatchObject({
      kind: "eligible",
      ceiling: record.ceiling,
    });
  });

  it("holds launch when the active record's ceiling permits no operations", async () => {
    const deps = sources();
    deps.readCurrentCandidates.mockResolvedValue([{ ...record, ceiling: { ...record.ceiling, operationKeys: [] } }]);
    expect(await resolveS5JsiEligibility(admission, deps, now)).toEqual({
      kind: "narrowed", reason: "operation-outside-ceiling",
    });
  });

  it("does not use a no-scheme result returned for an unresolved subject", async () => {
    const deps = sources();
    deps.readActivityPolicy.mockResolvedValue({ kind: "not-applicable" });
    expect(await resolveS5JsiEligibility({ ...context, subject: null }, deps, now)).toEqual({
      kind: "required-unavailable", reason: "subject-unresolved",
    });
  });

  it.each([undefined, null, false, { kind: "not-applicable", rollout: "disabled" }])(
    "does not infer absence from malformed or missing policy %j", async (policy) => {
      const deps = sources();
      deps.readActivityPolicy.mockResolvedValue(policy);
      expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
        kind: "unknown", source: "activity-policy", reason: "malformed",
      });
      expect(deps.readCurrentCandidates).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["required-scheme-absent", {}, { kind: "required", scheme: null }, true, [record]],
    ["compatible-record-missing", {}, { kind: "required", scheme: selector.scheme }, true, []],
    ["subject-unresolved", { subject: null }, { kind: "required", scheme: selector.scheme }, true, [record]],
    ["profile-unresolved", { profileFingerprint: null }, { kind: "required", scheme: selector.scheme }, true, [record]],
    ["serving-support-missing", {}, { kind: "required", scheme: selector.scheme }, false, [record]],
  ] as const)("keeps the required-unavailable reason %s", async (reason, over, policy, serving, candidates) => {
    const deps = sources();
    deps.readActivityPolicy.mockResolvedValue(policy);
    deps.readCurrentCandidates.mockResolvedValue(candidates);
    expect(await resolveS5JsiEligibility({ ...context, ...over }, serving ? deps : {
      readActivityPolicy: deps.readActivityPolicy,
    }, now)).toEqual({ kind: "required-unavailable", reason });
    expect(deps.readVerifiedAssessment).not.toHaveBeenCalled();
  });

  it.each([
    ["readActivityPolicy", "activity-policy"],
    ["readCurrentCandidates", "qualification-carrier"],
    ["readVerifiedAssessment", "assessment-evidence"],
  ] as const)("holds when %s throws without exposing source errors", async (method, source) => {
    const deps = sources();
    deps[method].mockRejectedValue(new Error("private source details"));
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({ kind: "unknown", source, reason: "unreadable" });
  });

  it("holds and aborts a stalled dependency", async () => {
    vi.useFakeTimers();
    try {
      const deps = sources();
      deps.readVerifiedAssessment.mockImplementation(() => new Promise(() => {}));
      const pending = resolveS5JsiEligibility(context, deps, now);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ kind: "unknown", source: "assessment-evidence", reason: "timed-out" });
      expect(deps.readVerifiedAssessment.mock.calls[0]?.[2].aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["pending-revalidation", "stale"], ["restricted", "narrowed"], ["suspended", "suspended"],
    ["expired", "stale"], ["revoked", "incompatible"],
  ] as const)("holds an active-to-%s transition at the next read", async (status, kind) => {
    const deps = sources();
    deps.readCurrentCandidates.mockResolvedValueOnce([record]).mockResolvedValueOnce([
      { ...record, status, statusRevision: record.statusRevision + 1 },
    ]);
    expect((await resolveS5JsiEligibility(context, deps, now)).kind).toBe("eligible");
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({ kind, reason: status });
    expect(deps.readVerifiedAssessment).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing list", null],
    ["missing row", [null]],
    ["unknown status", [{ ...record, status: "draft" }]],
    ["invalid revision", [{ ...record, statusRevision: 0 }]],
    ["empty validity window", [{ ...record, expiresAt: record.validFrom }]],
    ["missing evidence reference", [{ ...record, assessment: undefined }]],
    ["duplicate operation", [{ ...record, ceiling: { ...record.ceiling, operationKeys: ["validate-invoice", "validate-invoice"] } }]],
    ["conflicting exclusion", [{ ...record, ceiling: { ...record.ceiling, excludedOperationKeys: ["validate-invoice"] } }]],
  ])("rejects malformed carrier data (%s)", async (_case, rows) => {
    const deps = sources();
    deps.readCurrentCandidates.mockResolvedValue(rows);
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "unknown", source: "qualification-carrier", reason: "malformed",
    });
  });

  it("never picks or unions overlapping current versions", async () => {
    const deps = sources();
    deps.readCurrentCandidates.mockResolvedValue([record, {
      ...record,
      version: 3,
      ceiling: { ...record.ceiling, operationKeys: ["route-exception"] },
    }]);
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "unknown", source: "qualification-carrier", reason: "ambiguous",
    });
    expect(deps.readVerifiedAssessment).not.toHaveBeenCalled();
  });

  it.each([
    { subject: { ...selector.subject, gaid: "other" } },
    { subject: { ...selector.subject, principalId: "other" } },
    { job: { ...selector.job, version: "other" } },
    { scheme: { ...selector.scheme, version: "other" } },
    { organizationId: "other" }, { installationId: "other" }, { activityKey: "other" },
    { scope: { ...selector.scope, jurisdiction: "other" } },
    { profileFingerprint: "sha256:" + "a".repeat(64) },
  ])("rejects cross-profile or cross-scope carrier row %j", async (over) => {
    const deps = sources();
    deps.readCurrentCandidates.mockResolvedValue([{ ...record, selector: { ...selector, ...over } }]);
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "incompatible", reason: "selector-mismatch",
    });
    expect(deps.readVerifiedAssessment).not.toHaveBeenCalled();
  });

  it.each([
    ["expiresAt", t], ["reviewDueAt", t], ["validFrom", t + 1],
  ] as const)("holds at the %s validity boundary without a status sweep", async (field, value) => {
    const deps = sources();
    deps.readCurrentCandidates.mockResolvedValue([{ ...record, [field]: value }]);
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "stale", reason: field === "validFrom" ? "not-yet-valid" : "expired",
    });
  });

  it.each(["release-payment", "unknown-operation"])("does not provide a ceiling for %s", async (key) => {
    expect(await resolveS5JsiEligibility({ ...context, operationKey: key }, sources(), now)).toEqual({
      kind: "narrowed", reason: "operation-outside-ceiling",
    });
  });

  it.each([
    [null, "missing"], [{}, "malformed"], [[evidence, evidence], "malformed"],
  ])("does not elevate an active carrier without an exact readable assessment %j", async (value, reason) => {
    const deps = sources();
    deps.readVerifiedAssessment.mockResolvedValue(value);
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "unknown", source: "assessment-evidence", reason,
    });
  });

  it.each([
    { assessment: { ...assessment, digest: "sha256:" + "c".repeat(64) } },
    { assessment: { ...assessment, version: "2" } },
    { selector: { ...selector, activityKey: "other" } },
    { verdict: "inconclusive" }, { verdict: "fail" }, { criticalFailure: true },
    { assessorPrincipalId: context.subject.principalId },
    { assessedAt: record.issuedAt + 1 },
  ])("holds conflicting or non-passing assessment %j", async (over) => {
    const deps = sources();
    deps.readVerifiedAssessment.mockResolvedValue({ ...evidence, ...over });
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "incompatible", reason: "assessment-incompatible",
    });
  });

  it("holds stale evidence and uses its deadline when earlier than the record deadline", async () => {
    const deps = sources();
    deps.readVerifiedAssessment.mockResolvedValueOnce({ ...evidence, validUntil: t + 1 })
      .mockResolvedValueOnce({ ...evidence, validUntil: t });
    expect(await resolveS5JsiEligibility(context, deps, now)).toMatchObject({ kind: "eligible", validUntil: t + 1 });
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({ kind: "stale", reason: "assessment-expired" });
  });

  it("does not allow a record that expires while its evidence is being read", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(t);
      const deps = sources();
      deps.readVerifiedAssessment.mockImplementation(async () => {
        vi.setSystemTime(record.reviewDueAt);
        return evidence;
      });
      expect(await resolveS5JsiEligibility(context, deps)).toEqual({ kind: "stale", reason: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects self-issuance even when the resolved assessment passes", async () => {
    const deps = sources();
    deps.readCurrentCandidates.mockResolvedValue([{ ...record, issuerPrincipalId: context.subject.principalId }]);
    expect(await resolveS5JsiEligibility(context, deps, now)).toEqual({
      kind: "incompatible", reason: "assessment-incompatible",
    });
  });
});
