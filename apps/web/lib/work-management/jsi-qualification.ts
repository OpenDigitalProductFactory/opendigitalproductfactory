import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";

const key = z.string().min(1).refine((value) => value.trim() === value);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const revision = z.number().int().positive();
const instant = z.number().int().nonnegative();
const versionedRef = z.strictObject({ id: key, version: key });
const subject = z.strictObject({ principalId: key, gaid: key });
const activity = z.strictObject({
  organizationId: key,
  installationId: key,
  subject,
  job: versionedRef,
  activityKey: key,
  scope: z.strictObject({
    workflow: key,
    archetype: key,
    jurisdiction: key,
    dataClass: key,
    riskClass: key,
  }),
});
const admissionContext = activity.extend({
  subject: subject.nullable(),
  profileFingerprint: digest.nullable(),
  operationKey: key.optional(),
});
const selector = activity.extend({ profileFingerprint: digest, scheme: versionedRef });
const assessmentRef = versionedRef.extend({ digest });
const policy = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("not-applicable") }),
  z.strictObject({ kind: z.literal("required"), scheme: versionedRef.nullable() }),
]);

export const JsiQualificationStatus = z.enum([
  "active", "pending-revalidation", "restricted", "suspended", "expired", "revoked",
]);
export type JsiQualificationStatus = z.infer<typeof JsiQualificationStatus>;

const uniqueKeys = z.array(key).refine((keys) => new Set(keys).size === keys.length);
const ceiling = z.strictObject({
  operationKeys: uniqueKeys,
  excludedOperationKeys: uniqueKeys,
  oversight: z.enum(["review-before-effect", "review-after-execution", "continuous-supervision"]),
}).refine(({ operationKeys, excludedOperationKeys }) =>
  !operationKeys.some((operation) => excludedOperationKeys.includes(operation)));

const qualificationRecord = z.strictObject({
  id: key,
  version: revision,
  statusRevision: revision,
  status: JsiQualificationStatus,
  selector,
  ceiling,
  assessment: assessmentRef,
  issuerPrincipalId: key,
  assessorPrincipalId: key,
  issuedAt: instant,
  validFrom: instant,
  expiresAt: instant,
  reviewDueAt: instant,
}).refine((row) =>
  row.issuedAt <= row.validFrom && row.validFrom < Math.min(row.expiresAt, row.reviewDueAt));
const verifiedAssessment = z.strictObject({
  assessment: assessmentRef,
  selector,
  verdict: z.enum(["pass", "fail", "inconclusive"]),
  criticalFailure: z.boolean(),
  assessorPrincipalId: key,
  assessedAt: instant,
  validUntil: instant,
}).refine((row) => row.assessedAt < row.validUntil);

export type JsiAdmissionContext = z.infer<typeof admissionContext>;
export type JsiQualificationSelector = z.infer<typeof selector>;
export type JsiQualificationRecord = z.infer<typeof qualificationRecord>;
export type JsiRequiredUnavailableReason =
  | "required-scheme-absent"
  | "compatible-record-missing"
  | "subject-unresolved"
  | "profile-unresolved"
  | "serving-support-missing";

type JsiUnknownSource = "admission-context" | "activity-policy" | "qualification-carrier" | "assessment-evidence";
type JsiUnknown = {
  kind: "unknown";
  source: JsiUnknownSource;
  reason: "malformed" | "unreadable" | "timed-out" | "ambiguous" | "missing";
};
type JsiStatusHold =
  | { kind: "stale"; reason: "pending-revalidation" | "expired" }
  | { kind: "narrowed"; reason: "restricted" }
  | { kind: "suspended"; reason: "suspended" }
  | { kind: "incompatible"; reason: "revoked" };
const statusHold = {
  "pending-revalidation": { kind: "stale", reason: "pending-revalidation" },
  restricted: { kind: "narrowed", reason: "restricted" },
  suspended: { kind: "suspended", reason: "suspended" },
  expired: { kind: "stale", reason: "expired" },
  revoked: { kind: "incompatible", reason: "revoked" },
} satisfies Record<Exclude<JsiQualificationStatus, "active">, JsiStatusHold>;

export type JsiEligibilityDecision =
  | { kind: "not-applicable" }
  | { kind: "required-unavailable"; reason: JsiRequiredUnavailableReason }
  | JsiUnknown
  | JsiStatusHold
  | { kind: "stale"; reason: "not-yet-valid" | "assessment-expired" }
  | { kind: "incompatible"; reason: "selector-mismatch" | "assessment-incompatible" }
  | { kind: "narrowed"; reason: "operation-outside-ceiling" }
  | {
      kind: "eligible";
      qualification: Pick<JsiQualificationRecord, "id" | "version" | "statusRevision">;
      selector: JsiQualificationSelector;
      ceiling: z.infer<typeof ceiling>;
      validUntil: number;
    };

export interface JsiQualificationSources {
  /** Authoritative server-owned job/activity policy. Null/failed lookup never establishes absence. */
  readActivityPolicy: (activity: Omit<JsiAdmissionContext, "profileFingerprint" | "operationKey">, signal: AbortSignal) => Promise<unknown>;
  /**
   * Current versions in the exact slot from the one canonical carrier, including non-active
   * states and excluding superseded history. Do not filter statuses or deduplicate. Return at
   * most two rows, enough to detect overlap without scanning or returning the record history.
   */
  readCurrentCandidates?: (selector: JsiQualificationSelector, signal: AbortSignal) => Promise<unknown>;
  /**
   * Existing evidence owner's re-verification path. It checks current source authority, integrity
   * (including the content digest), acceptance and scheme independence rules; never return caller
   * assertions or raw evidence. The resolver cross-checks this projection against the carrier.
   */
  readVerifiedAssessment?: (
    reference: z.infer<typeof assessmentRef>,
    selector: JsiQualificationSelector,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

const unavailable = (reason: JsiRequiredUnavailableReason): JsiEligibilityDecision =>
  ({ kind: "required-unavailable", reason });
const unknown = (source: JsiUnknownSource, reason: JsiUnknown["reason"]): JsiUnknown =>
  ({ kind: "unknown", source, reason });

// Bound each source even if an adapter fails to honor cancellation.
// Timeout resolves first so the abort-triggered rejection cannot disguise it.
async function readSource(
  source: JsiUnknownSource,
  read: (signal: AbortSignal) => Promise<unknown>,
): Promise<{ kind: "read"; value: unknown } | { kind: "hold"; decision: JsiUnknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<{ kind: "hold"; decision: JsiUnknown }>((resolve) => {
        timer = setTimeout(() => {
          resolve({ kind: "hold", decision: unknown(source, "timed-out") });
          controller.abort();
        }, 2_000);
      }),
      Promise.resolve().then(() => read(controller.signal)).then((value) => ({ kind: "read" as const, value })),
    ]);
  } catch {
    return { kind: "hold", decision: unknown(source, "unreadable") };
  } finally {
    clearTimeout(timer);
  }
}

function sameExactValue(left: object, right: object): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * S5's JSI producer. Input and source ports are server-owned. This check returns
 * only a ceiling and provenance, not action authority or a bearer credential.
 * Launch reads the full ceiling without an operation key. Invocation supplies
 * the exact operation key. Both need fresh reads, with the eventual effect
 * fence and independent grants/binding checks owned by their governed consumer.
 */
export async function resolveS5JsiEligibility(
  context: JsiAdmissionContext,
  sources: JsiQualificationSources,
  now?: Date,
): Promise<JsiEligibilityDecision> {
  const clock = () => (now ?? new Date()).getTime();
  const parsed = admissionContext.safeParse(context);
  if (!parsed.success || !Number.isFinite(clock())) return unknown("admission-context", "malformed");
  const { profileFingerprint, operationKey, ...assignedActivity } = parsed.data;
  const policyRead = await readSource("activity-policy", (signal) => sources.readActivityPolicy(assignedActivity, signal));
  if (policyRead.kind === "hold") return policyRead.decision;
  const applicability = policy.safeParse(policyRead.value);
  if (!applicability.success) return unknown("activity-policy", "malformed");
  if (!assignedActivity.subject) return unavailable("subject-unresolved");
  if (applicability.data.kind === "not-applicable") return { kind: "not-applicable" };
  const { scheme } = applicability.data;
  if (!scheme) return unavailable("required-scheme-absent");
  if (!profileFingerprint) return unavailable("profile-unresolved");

  const { readCurrentCandidates, readVerifiedAssessment } = sources;
  if (!readCurrentCandidates || !readVerifiedAssessment) return unavailable("serving-support-missing");
  const exact = { ...assignedActivity, subject: assignedActivity.subject, profileFingerprint, scheme };
  const carrierRead = await readSource("qualification-carrier", (signal) => readCurrentCandidates(exact, signal));
  if (carrierRead.kind === "hold") return carrierRead.decision;
  const rows = carrierRead.value;
  if (!Array.isArray(rows)) return unknown("qualification-carrier", "malformed");
  if (rows.length > 1) return unknown("qualification-carrier", "ambiguous");
  if (rows.length === 0) return unavailable("compatible-record-missing");
  const record = qualificationRecord.safeParse(rows[0]);
  if (!record.success) return unknown("qualification-carrier", "malformed");
  const row = record.data;
  if (!sameExactValue(row.selector, exact)) return { kind: "incompatible", reason: "selector-mismatch" };
  if (row.status !== "active") return { ...statusHold[row.status] };

  const deadline = Math.min(row.expiresAt, row.reviewDueAt);
  const recordHold = (): JsiEligibilityDecision | undefined => {
    const current = clock();
    if (current >= deadline) return { kind: "stale", reason: "expired" };
    if (current < row.validFrom) return { kind: "stale", reason: "not-yet-valid" };
  };
  const hold = recordHold();
  if (hold) return hold;
  const { operationKeys } = row.ceiling;
  if (operationKeys.length === 0 || (operationKey !== undefined && !operationKeys.includes(operationKey))) {
    return { kind: "narrowed", reason: "operation-outside-ceiling" };
  }

  const evidenceRead = await readSource("assessment-evidence", (signal) =>
    readVerifiedAssessment(row.assessment, exact, signal));
  if (evidenceRead.kind === "hold") return evidenceRead.decision;
  if (evidenceRead.value === null) return unknown("assessment-evidence", "missing");
  const parsedEvidence = verifiedAssessment.safeParse(evidenceRead.value);
  if (!parsedEvidence.success) return unknown("assessment-evidence", "malformed");
  const evidence = parsedEvidence.data;
  if (!sameExactValue(evidence.assessment, row.assessment)
      || !sameExactValue(evidence.selector, exact)
      || evidence.verdict !== "pass" || evidence.criticalFailure
      || evidence.assessorPrincipalId !== row.assessorPrincipalId
      || evidence.assessorPrincipalId === exact.subject.principalId
      || row.issuerPrincipalId === exact.subject.principalId
      || evidence.assessedAt > row.issuedAt) {
    return { kind: "incompatible", reason: "assessment-incompatible" };
  }

  const freshHold = recordHold();
  if (freshHold) return freshHold;
  if (clock() >= evidence.validUntil) return { kind: "stale", reason: "assessment-expired" };
  return {
    kind: "eligible",
    qualification: { id: row.id, version: row.version, statusRevision: row.statusRevision },
    selector: exact,
    ceiling: row.ceiling,
    validUntil: Math.min(deadline, evidence.validUntil),
  };
}
