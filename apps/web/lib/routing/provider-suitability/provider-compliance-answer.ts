import {
  PROVIDER_COMPLIANCE_SOURCE_REGISTRY,
  type ProviderComplianceSourceEntry,
} from "@dpf/db/provider-compliance-source-registry";

export const PROVIDER_COMPLIANCE_ANSWER_SCHEMA_VERSION =
  "provider-compliance-answer.v1" as const;

export type ProviderComplianceAnswerState =
  | "substantiated"
  | "conditional"
  | "cannot_substantiate";

export type ProviderComplianceFactOrigin = "sourced" | "declared" | "technically-verified";

export type ProviderComplianceAnswerScope = {
  providerId: string;
  service: string;
  accountClass: string;
  jurisdiction: string;
  region: string;
  workload: string;
  dataClasses: string[];
};

export type ProviderComplianceEvidenceClaimDraft = {
  claimId: string;
  claim: string;
  sourceKey: string;
  sourceClaimId: string;
  material: boolean;
};

export type ProviderComplianceAnswerDraft = {
  directAnswer: string;
  practicalMeaning: string;
  appliesTo: ProviderComplianceAnswerScope;
  evidenceClaims: ProviderComplianceEvidenceClaimDraft[];
  organizationFactsUsed: Array<{ fact: string; origin: "declared" | "technically-verified" }>;
  missingFacts: string[];
  followUpQuestion?: string;
  recommendation: string;
  safeInterimBehavior: string;
  requiredReviewer: string;
  proposedPostureChange: Record<string, unknown> | null;
};

export type ProviderComplianceAnswerIssueCode =
  | "invalid-direct-answer"
  | "missing-source"
  | "non-authoritative-source"
  | "stale-source"
  | "citation-mismatch"
  | "provider-mismatch"
  | "service-mismatch"
  | "account-mismatch"
  | "jurisdiction-mismatch"
  | "region-mismatch"
  | "workload-mismatch"
  | "conflicting-evidence"
  | "missing-material-evidence";

export type ProviderComplianceAnswerIssue = {
  code: ProviderComplianceAnswerIssueCode;
  claimId?: string;
  sourceKey?: string;
  detail: string;
};

export type ProviderComplianceValidatedClaim = ProviderComplianceEvidenceClaimDraft & {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  authority: "primary" | "first-party";
  supportSummary: string;
};

export type ProviderComplianceValidatedAnswer = Omit<
  ProviderComplianceAnswerDraft,
  "evidenceClaims"
> & {
  schemaVersion: typeof PROVIDER_COMPLIANCE_ANSWER_SCHEMA_VERSION;
  answerState: ProviderComplianceAnswerState;
  evidenceClaims: ProviderComplianceValidatedClaim[];
  answeredAt: string;
};

export type ProviderComplianceGapReason =
  | "missing-topic"
  | "stale-source"
  | "citation-mismatch"
  | "conflicting-evidence";

type SourceRegistry = Record<string, ProviderComplianceSourceEntry>;

const DIRECT_ANSWER_PATTERN = /^(?:Yes|No|Only if|Cannot confirm)(?:\b|[.!,:;—-])/;

function scopeAllows(values: readonly string[], requested: string): boolean {
  return values.includes("*") || values.includes(requested);
}

function ageDays(retrievedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(retrievedAt)) / 86_400_000;
}

function validateClaim(
  claim: ProviderComplianceEvidenceClaimDraft,
  scope: ProviderComplianceAnswerScope,
  registry: SourceRegistry,
  now: Date,
): { validated: ProviderComplianceValidatedClaim | null; issues: ProviderComplianceAnswerIssue[]; conflictKey?: string; position?: string } {
  const source = registry[claim.sourceKey];
  if (!source) {
    return {
      validated: null,
      issues: [{ code: "missing-source", claimId: claim.claimId, sourceKey: claim.sourceKey, detail: "The cited source is not in the governed source registry." }],
    };
  }
  if (source.authority === "secondary") {
    return {
      validated: null,
      issues: [{ code: "non-authoritative-source", claimId: claim.claimId, sourceKey: claim.sourceKey, detail: "A secondary source cannot substantiate this material provider-compliance claim." }],
    };
  }
  if (ageDays(source.retrievedAt, now) > source.maxAgeDays) {
    return {
      validated: null,
      issues: [{ code: "stale-source", claimId: claim.claimId, sourceKey: claim.sourceKey, detail: "The source is older than its governed freshness window." }],
    };
  }
  const sourceClaim = source.claims.find((candidate) => candidate.claimId === claim.sourceClaimId);
  if (!sourceClaim) {
    return {
      validated: null,
      issues: [{ code: "citation-mismatch", claimId: claim.claimId, sourceKey: claim.sourceKey, detail: "The canonical source registry does not map this source to the claimed proposition." }],
    };
  }
  const checks: Array<[ProviderComplianceAnswerIssueCode, readonly string[], string]> = [
    ["provider-mismatch", sourceClaim.appliesTo.providerIds, scope.providerId],
    ["service-mismatch", sourceClaim.appliesTo.services, scope.service],
    ["account-mismatch", sourceClaim.appliesTo.accountClasses, scope.accountClass],
    ["jurisdiction-mismatch", sourceClaim.appliesTo.jurisdictions, scope.jurisdiction],
    ["region-mismatch", sourceClaim.appliesTo.regions, scope.region],
    ["workload-mismatch", sourceClaim.appliesTo.workloads, scope.workload],
  ];
  const mismatch = checks.find(([, values, requested]) => !scopeAllows(values, requested));
  if (mismatch) {
    return {
      validated: null,
      issues: [{
        code: mismatch[0],
        claimId: claim.claimId,
        sourceKey: claim.sourceKey,
        detail: `The source claim does not apply to requested value '${mismatch[2]}'.`,
      }],
    };
  }
  return {
    validated: {
      ...claim,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      publishedAt: source.publishedAt ?? null,
      retrievedAt: source.retrievedAt,
      authority: source.authority,
      supportSummary: sourceClaim.summary,
    },
    issues: [],
    conflictKey: sourceClaim.conflictKey,
    position: sourceClaim.position,
  };
}

function gapReasonForIssue(code: ProviderComplianceAnswerIssueCode): ProviderComplianceGapReason | null {
  if (code === "stale-source") return "stale-source";
  if (code === "citation-mismatch" || code.endsWith("-mismatch")) return "citation-mismatch";
  if (code === "conflicting-evidence") return "conflicting-evidence";
  if (code === "missing-source" || code === "missing-material-evidence") return "missing-topic";
  return null;
}

export function validateProviderComplianceAnswer(
  draft: ProviderComplianceAnswerDraft,
  options: { now?: Date; sources?: SourceRegistry } = {},
): {
  answer: ProviderComplianceValidatedAnswer;
  issues: ProviderComplianceAnswerIssue[];
  gapReasons: ProviderComplianceGapReason[];
  policyMutationAllowed: false;
} {
  const now = options.now ?? new Date();
  const registry = options.sources ?? PROVIDER_COMPLIANCE_SOURCE_REGISTRY;
  const issues: ProviderComplianceAnswerIssue[] = [];
  const candidates = draft.evidenceClaims.map((claim) => {
    const result = validateClaim(claim, draft.appliesTo, registry, now);
    issues.push(...result.issues);
    return { claim, ...result };
  });

  const conflictPositions = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!candidate.validated || !candidate.conflictKey || !candidate.position) continue;
    const positions = conflictPositions.get(candidate.conflictKey) ?? new Set<string>();
    positions.add(candidate.position);
    conflictPositions.set(candidate.conflictKey, positions);
  }
  const conflictingKeys = new Set(
    [...conflictPositions.entries()].filter(([, positions]) => positions.size > 1).map(([key]) => key),
  );
  if (conflictingKeys.size > 0) {
    issues.push({ code: "conflicting-evidence", detail: "Current authoritative sources support conflicting positions for this answer." });
  }
  const evidenceClaims = candidates
    .filter((candidate) => candidate.validated && (!candidate.conflictKey || !conflictingKeys.has(candidate.conflictKey)))
    .map((candidate) => candidate.validated!);

  const directAnswerValid = DIRECT_ANSWER_PATTERN.test(draft.directAnswer.trim());
  if (!directAnswerValid) {
    issues.push({ code: "invalid-direct-answer", detail: "The answer must begin Yes, No, Only if, or Cannot confirm." });
  }
  const hasMaterialDraft = draft.evidenceClaims.some((claim) => claim.material);
  const hasMaterialEvidence = evidenceClaims.some((claim) => claim.material);
  if (!hasMaterialEvidence) {
    issues.push({ code: "missing-material-evidence", detail: "No material external claim survived source validation." });
  }

  let answerState: ProviderComplianceAnswerState = "substantiated";
  if (
    !directAnswerValid ||
    draft.directAnswer.trim().startsWith("Cannot confirm") ||
    !hasMaterialEvidence ||
    conflictingKeys.size > 0
  ) {
    answerState = "cannot_substantiate";
  } else if (draft.missingFacts.length > 0 || issues.length > 0 || (hasMaterialDraft && evidenceClaims.length < draft.evidenceClaims.length)) {
    answerState = "conditional";
  }

  const directAnswer = answerState === "cannot_substantiate"
    ? "Cannot confirm this yet."
    : answerState === "conditional" && !draft.directAnswer.trim().startsWith("Only if")
      ? `Only if ${draft.directAnswer.trim().replace(/^(?:Yes|No)\b[.!,:;—-]?\s*/i, "")}`
      : draft.directAnswer.trim();
  const gapReasons = [...new Set(issues.map((issue) => gapReasonForIssue(issue.code)).filter((reason): reason is ProviderComplianceGapReason => reason !== null))];

  return {
    answer: {
      ...draft,
      schemaVersion: PROVIDER_COMPLIANCE_ANSWER_SCHEMA_VERSION,
      answerState,
      directAnswer,
      evidenceClaims,
      answeredAt: now.toISOString(),
    },
    issues,
    gapReasons,
    policyMutationAllowed: false,
  };
}
