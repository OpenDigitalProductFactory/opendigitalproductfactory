// apps/web/lib/govern/data/executable-policies.ts
// BI-DG-002 (spec §6.5): typed, versioned, testable platform data policies. PURE.
// Existing `Policy` records remain the human-readable documents; these are the
// executable rules the PDP evaluates. A rule binds to logical axes (action, category,
// sensitivity, asset, domain, purpose, subject role, destination) — never only to a
// physical table name — and declares its precedence level + effect + obligations.

import type {
  DataAction,
  DataAssetId,
  DataCategory,
  DataEffect,
  DataSensitivity,
  DestinationClass,
  MasterDataDomainKey,
  PrecedenceLevel,
  ProcessingPurposeKey,
  SubjectRole,
} from "./taxonomy";

/** A single obligation a policy attaches to an allow-with-obligations effect (§6.5). */
export type DataObligation =
  | { kind: "mask"; profileId: string }
  | { kind: "encrypt"; protectionProfileId: string }
  | { kind: "destination"; allowedClasses: DestinationClass[] }
  | { kind: "log-use"; evidenceClass: string; minimumRetentionClass: string }
  | { kind: "human-approval"; authorityRole: string; separationOfDuties: boolean }
  | { kind: "delete-derived-copy"; contractIds: string[]; deadlineSeconds: number }
  | { kind: "disposition-evidence"; evidenceProfileId: string };

export type DataObligationKind = DataObligation["kind"];

/** The axes a policy matches on. An omitted axis means "any". */
export type PolicyMatch = {
  actions?: readonly DataAction[];
  categories?: readonly DataCategory[];
  sensitivities?: readonly DataSensitivity[];
  assets?: readonly DataAssetId[];
  domains?: readonly MasterDataDomainKey[];
  purposes?: readonly ProcessingPurposeKey[];
  subjectRoles?: readonly SubjectRole[];
  destinations?: readonly DestinationClass[];
};

export type DataExecutablePolicy = {
  id: string;
  version: string;
  precedenceLevel: PrecedenceLevel;
  match: PolicyMatch;
  effect: DataEffect;
  obligations?: readonly DataObligation[];
  /** Link to the governing authority/requirement (a Policy/authority id), if any. */
  authorityRef?: string;
  explanationCode: string;
  effectiveFrom: string;
  expiresAt?: string;
};

// ─── Platform-default policy bundle ──────────────────────────────────────────
// Conservative, non-waivable defaults. Organizations narrow further via runtime
// policy; they cannot widen these without an approved, expiring exception (§6.1).

const POLICIES: readonly DataExecutablePolicy[] = [
  // NOTE: prohibited-storage is NOT a bundle policy — `PolicyMatch` has no
  // collectionRule axis, so an empty match would be a catch-all deny. It is enforced
  // as a hard backstop inside evaluateDataPolicy (collectionRule === "prohibited").
  {
    id: "restricted-external-destination",
    version: "1",
    precedenceLevel: "mandatory-authority",
    match: {
      actions: ["project", "export"],
      sensitivities: ["restricted"],
      destinations: ["external-service"],
    },
    effect: "deny",
    explanationCode: "restricted-cannot-leave-boundary",
    effectiveFrom: "2026-07-17",
  },
  {
    id: "confidential-projection-mask",
    version: "1",
    precedenceLevel: "organization-policy",
    match: { actions: ["project"], sensitivities: ["confidential"] },
    effect: "allow-with-obligations",
    obligations: [{ kind: "mask", profileId: "default-confidential" }],
    explanationCode: "confidential-masked-before-projection",
    effectiveFrom: "2026-07-17",
  },
  {
    id: "destructive-action-evidence",
    version: "1",
    precedenceLevel: "organization-policy",
    match: { actions: ["delete", "anonymize"] },
    effect: "allow-with-obligations",
    obligations: [{ kind: "disposition-evidence", evidenceProfileId: "default-disposition" }],
    explanationCode: "destructive-needs-disposition-evidence",
    effectiveFrom: "2026-07-17",
  },
];

export const DATA_EXECUTABLE_POLICIES = POLICIES;

/** Obligation kinds referenced by the default bundle — used by PEP matrix checks. */
export function obligationKindsInBundle(
  policies: readonly DataExecutablePolicy[] = POLICIES,
): ReadonlySet<DataObligationKind> {
  const kinds = new Set<DataObligationKind>();
  for (const p of policies) for (const o of p.obligations ?? []) kinds.add(o.kind);
  return kinds;
}
