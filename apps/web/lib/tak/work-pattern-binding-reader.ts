import { prisma } from "@dpf/db";
import {
  CAPABILITY_INSTALL_SCOPES,
  type CapabilityInstallScope,
} from "@dpf/db/capability-maturity";

import type { RiskClass } from "@/lib/autonomy/trust-graduation";
import { isRecord } from "@/lib/shared/coerce";

export const WORK_PATTERN_BINDING_RESOURCE_TYPE = "work-pattern";

export const WORK_PATTERN_BINDING_STATUSES = [
  "active",
  "superseded",
  "rolled-back",
  "retired",
] as const;

export type WorkPatternBindingStatus =
  (typeof WORK_PATTERN_BINDING_STATUSES)[number];

export type WorkPatternScopeCeiling =
  | "same-install"
  | "canonical-corpus"
  | "corroborated";

export type WorkPatternEvidenceOrigin =
  | "customer-zero"
  | "portable-canonical-corpus"
  | "customer-corroborated";

export type WorkPatternAuthorityScopeV1 = {
  schemaVersion: 1;
  activationLaneKey: string;
  bindingScopeKey: string;
  patternKey: string;
  patternVersion: number;
  activityKey: string;
  riskClass: RiskClass;
  installScopes: CapabilityInstallScope[];
  organizationIds: string[];
  taskCorpusKeys: string[];
  modelProfileIds: string[];
  promotionPolicyKey: string;
  promotionPolicyVersion: number;
  sourceExperimentTaskRunId: string;
  corroborationTaskRunIds: string[];
  priorSafeBindingId: string | null;
  evidenceFreshnessAt: string;
  evidenceOrigin: WorkPatternEvidenceOrigin;
  scopeCeiling: WorkPatternScopeCeiling;
  blockers: string[];
};

export type WorkPatternBindingRecord = {
  bindingId: string;
  name: string;
  status: string;
  resourceRef: string;
  authorityScope: WorkPatternAuthorityScopeV1;
  updatedAt: Date;
};

export type WorkPatternBindingReaderDb = {
  listBindings(agentId: string): Promise<Array<{
    bindingId: string;
    name: string;
    status: string;
    resourceRef: string;
    authorityScope: unknown;
    updatedAt: Date;
  }>>;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function stringArray(value: unknown, options?: { allowEmpty?: boolean }): string[] | null {
  if (
    !Array.isArray(value)
    || (!options?.allowEmpty && value.length === 0)
    || value.some((entry) => !nonEmptyString(entry))
  ) {
    return null;
  }
  const strings = value as string[];
  return new Set(strings).size === strings.length ? strings : null;
}

function installScopes(value: unknown): CapabilityInstallScope[] | null {
  const values = stringArray(value);
  if (
    !values
    || values.some(
      (scope) => !(CAPABILITY_INSTALL_SCOPES as readonly string[]).includes(scope),
    )
  ) {
    return null;
  }
  return values as CapabilityInstallScope[];
}

function riskClass(value: unknown): RiskClass | null {
  return (
    value === "read-only"
    || value === "internal-reversible"
    || value === "internal-irreversible"
    || value === "outbound-or-floor"
  )
    ? value
    : null;
}

function scopeCeiling(value: unknown): WorkPatternScopeCeiling | null {
  return (
    value === "same-install"
    || value === "canonical-corpus"
    || value === "corroborated"
  )
    ? value
    : null;
}

function evidenceOrigin(value: unknown): WorkPatternEvidenceOrigin | null {
  return (
    value === "customer-zero"
    || value === "portable-canonical-corpus"
    || value === "customer-corroborated"
  )
    ? value
    : null;
}

function validDateString(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function parseWorkPatternAuthorityScope(
  value: unknown,
): WorkPatternAuthorityScopeV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const parsedRiskClass = riskClass(value.riskClass);
  const parsedInstallScopes = installScopes(value.installScopes);
  const organizationIds = stringArray(value.organizationIds, { allowEmpty: true });
  const taskCorpusKeys = stringArray(value.taskCorpusKeys);
  const modelProfileIds = stringArray(value.modelProfileIds);
  const corroborationTaskRunIds = stringArray(
    value.corroborationTaskRunIds,
    { allowEmpty: true },
  );
  const blockers = stringArray(value.blockers, { allowEmpty: true });
  const parsedCeiling = scopeCeiling(value.scopeCeiling);
  const parsedOrigin = evidenceOrigin(value.evidenceOrigin);
  const requiredStrings = [
    value.activationLaneKey,
    value.bindingScopeKey,
    value.patternKey,
    value.activityKey,
    value.promotionPolicyKey,
    value.sourceExperimentTaskRunId,
  ];
  if (
    requiredStrings.some((entry) => !nonEmptyString(entry))
    || !positiveInteger(value.patternVersion)
    || !positiveInteger(value.promotionPolicyVersion)
    || !parsedRiskClass
    || !parsedInstallScopes
    || !organizationIds
    || !taskCorpusKeys
    || !modelProfileIds
    || !corroborationTaskRunIds
    || !blockers
    || !parsedCeiling
    || !parsedOrigin
    || !validDateString(value.evidenceFreshnessAt)
    || (
      value.priorSafeBindingId !== null
      && !nonEmptyString(value.priorSafeBindingId)
    )
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    activationLaneKey: value.activationLaneKey as string,
    bindingScopeKey: value.bindingScopeKey as string,
    patternKey: value.patternKey as string,
    patternVersion: value.patternVersion,
    activityKey: value.activityKey as string,
    riskClass: parsedRiskClass,
    installScopes: parsedInstallScopes,
    organizationIds,
    taskCorpusKeys,
    modelProfileIds,
    promotionPolicyKey: value.promotionPolicyKey as string,
    promotionPolicyVersion: value.promotionPolicyVersion,
    sourceExperimentTaskRunId: value.sourceExperimentTaskRunId as string,
    corroborationTaskRunIds,
    priorSafeBindingId: value.priorSafeBindingId as string | null,
    evidenceFreshnessAt: value.evidenceFreshnessAt,
    evidenceOrigin: parsedOrigin,
    scopeCeiling: parsedCeiling,
    blockers,
  };
}

function defaultDb(): WorkPatternBindingReaderDb {
  return {
    listBindings: (agentId) =>
      prisma.authorityBinding.findMany({
        where: {
          resourceType: WORK_PATTERN_BINDING_RESOURCE_TYPE,
          appliedAgent: { agentId },
        },
        select: {
          bindingId: true,
          name: true,
          status: true,
          resourceRef: true,
          authorityScope: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "desc" }, { bindingId: "asc" }],
      }),
  };
}

export async function listWorkPatternBindingsForAgent(
  agentId: string,
  deps?: { db?: WorkPatternBindingReaderDb },
): Promise<WorkPatternBindingRecord[]> {
  const rows = await (deps?.db ?? defaultDb()).listBindings(agentId);
  return rows.flatMap((row) => {
    const authorityScope = parseWorkPatternAuthorityScope(row.authorityScope);
    return authorityScope ? [{ ...row, authorityScope }] : [];
  });
}

const BLOCKER_COPY: Record<string, string> = {
  broader_scope_requires_portable_corpus_or_customer_corroboration:
    "Broader use needs a verified replay corpus or corroborating customer evidence.",
};

function daysAgoLabel(iso: string, now: Date): string {
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(iso)) / (24 * 60 * 60 * 1000)),
  );
  if (ageDays === 0) return "Evidence checked today";
  if (ageDays === 1) return "Evidence checked 1 day ago";
  return `Evidence checked ${ageDays} days ago`;
}

export function getWorkPatternBindingPresentation(
  binding: WorkPatternBindingRecord,
  now = new Date(),
) {
  const stateLabel =
    binding.status === "active"
      ? "Active method"
      : binding.status === "rolled-back"
        ? "Rolled back"
        : binding.status === "superseded"
          ? "Replaced by a safer method"
          : "Retired method";
  const scopeLabel =
    binding.authorityScope.scopeCeiling === "same-install"
      ? "Only this DPF installation"
      : binding.authorityScope.scopeCeiling === "canonical-corpus"
        ? "This installation and the verified replay corpus"
        : "Verified installations and task corpora";
  const evidenceLabel =
    binding.authorityScope.evidenceOrigin === "customer-zero"
      ? "Proven on DPF's own work"
      : binding.authorityScope.evidenceOrigin === "portable-canonical-corpus"
        ? "Proven on a portable replay corpus"
        : "Corroborated with customer evidence";

  return {
    stateLabel,
    scopeLabel,
    evidenceLabel,
    freshnessLabel: daysAgoLabel(binding.authorityScope.evidenceFreshnessAt, now),
    blockerMessages: binding.authorityScope.blockers.map(
      (blocker) => BLOCKER_COPY[blocker] ?? "More governed evidence is required.",
    ),
  };
}
