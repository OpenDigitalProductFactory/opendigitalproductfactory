import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@dpf/db";

import type {
  ProviderConnectionPosture,
  ProviderContractEvidence,
  ProviderEntitlements,
  ProviderSuitabilityPolicy,
} from "./types";

export const PROVIDER_TRUST_CLAIM_KEYS = [
  "no-training",
  "zero-retention",
  "regional-processing",
  "enabled-regions",
  "approved-underlying-providers",
  "admin-audit-controls",
  "enterprise-support-sla",
  "baa-on-file",
  "dpa-on-file",
  "soc2",
  "iso27001",
  "fedramp-eligible",
  "service-provider-oversight-reviewed-at",
  "student-data-terms-reviewed-at",
  "financial-customer-info-reviewed-at",
] as const;

export type ProviderTrustClaimKey = (typeof PROVIDER_TRUST_CLAIM_KEYS)[number];
export type ProviderTrustEvidenceStatus =
  | "valid"
  | "missing"
  | "expired"
  | "rejected"
  | "conflicting"
  | "superseded";

export type ProviderTrustEvidenceRecord = {
  evidenceId: string;
  providerConnectionId: string | null;
  evidenceType: string;
  claimKey: string | null;
  assertedValue: unknown;
  status: string;
  collectedAt: Date;
  validFrom: Date | null;
  expiresAt: Date | null;
  supersededById: string | null;
};

export type ResolvedProviderTrustClaim = {
  claimKey: ProviderTrustClaimKey;
  status: ProviderTrustEvidenceStatus;
  evidenceIds: string[];
  evidenceAgeDays: number | null;
  expiresAt: string | null;
  nextAction: string;
};

export type ProviderTrustEvidenceResolution = {
  posture: ProviderConnectionPosture;
  claims: ResolvedProviderTrustClaim[];
  hasActionRequired: boolean;
};

type CurrentSupplierContract = {
  contractId: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(sortedUnique(value.filter((item): item is string => typeof item === "string")));
  return JSON.stringify(value);
}

function isClaimKey(value: string | null): value is ProviderTrustClaimKey {
  return PROVIDER_TRUST_CLAIM_KEYS.includes(value as ProviderTrustClaimKey);
}

function isCurrent(record: ProviderTrustEvidenceRecord, now: Date): boolean {
  return record.status === "active"
    && !record.supersededById
    && (!record.validFrom || record.validFrom.getTime() <= now.getTime())
    && (!record.expiresAt || record.expiresAt.getTime() > now.getTime());
}

function contractIsCurrent(contract: CurrentSupplierContract | undefined, now: Date): boolean {
  return Boolean(
    contract
      && contract.status === "active"
      && (!contract.startDate || contract.startDate.getTime() <= now.getTime())
      && (!contract.endDate || contract.endDate.getTime() > now.getTime()),
  );
}

function ageDays(collectedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - collectedAt.getTime()) / 86_400_000));
}

function nextAction(status: ProviderTrustEvidenceStatus): string {
  switch (status) {
    case "valid": return "No action required.";
    case "expired": return "Renew or replace the expired evidence.";
    case "rejected": return "Resolve the rejected evidence before restricted routing.";
    case "conflicting": return "Resolve the conflicting assertions before restricted routing.";
    case "superseded": return "Link the current replacement evidence.";
    case "missing": return "Add evidence for this connected account.";
  }
}

function classifyClaim(
  claimKey: ProviderTrustClaimKey,
  records: ProviderTrustEvidenceRecord[],
  now: Date,
): { summary: ResolvedProviderTrustClaim; accepted: ProviderTrustEvidenceRecord | null } {
  const current = records.filter((record) => isCurrent(record, now));
  const distinctValues = new Set(current.map((record) => stableValue(record.assertedValue)));
  let status: ProviderTrustEvidenceStatus;
  let accepted: ProviderTrustEvidenceRecord | null = null;

  if (distinctValues.size > 1) status = "conflicting";
  else if (current.length > 0) {
    status = "valid";
    accepted = [...current].sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime())[0] ?? null;
  } else if (records.some((record) => record.status === "rejected")) status = "rejected";
  else if (records.some((record) => record.status === "active" && record.expiresAt && record.expiresAt.getTime() <= now.getTime())) status = "expired";
  else if (records.some((record) => record.status === "superseded" || record.supersededById)) status = "superseded";
  else status = "missing";

  const newest = [...records].sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime())[0];
  return {
    accepted,
    summary: {
      claimKey,
      status,
      evidenceIds: records.map((record) => record.evidenceId).sort(),
      evidenceAgeDays: newest ? ageDays(newest.collectedAt, now) : null,
      expiresAt: newest?.expiresAt?.toISOString() ?? null,
      nextAction: nextAction(status),
    },
  };
}

function applyClaim(
  claimKey: ProviderTrustClaimKey,
  value: unknown,
  contractEvidence: ProviderContractEvidence,
  entitlements: ProviderEntitlements,
): void {
  const booleanValue = typeof value === "boolean" ? value : undefined;
  const stringValue = typeof value === "string" ? value : undefined;
  switch (claimKey) {
    case "no-training": entitlements.noTraining = booleanValue; break;
    case "zero-retention": entitlements.zeroRetention = booleanValue; break;
    case "regional-processing": entitlements.regionalProcessing = booleanValue; break;
    case "enabled-regions":
      entitlements.enabledRegions = Array.isArray(value)
        ? sortedUnique(value.filter((item): item is string => typeof item === "string").map((region) => region.toLowerCase()))
        : [];
      break;
    case "approved-underlying-providers":
      entitlements.approvedUnderlyingProviderSlugs = Array.isArray(value)
        ? sortedUnique(value.filter((item): item is string => typeof item === "string").map((slug) => slug.toLowerCase()))
        : [];
      break;
    case "admin-audit-controls": entitlements.adminAuditControls = booleanValue; break;
    case "enterprise-support-sla": entitlements.enterpriseSupportOrSla = booleanValue; break;
    case "baa-on-file": contractEvidence.baaOnFile = booleanValue; break;
    case "dpa-on-file": contractEvidence.dpaOnFile = booleanValue; break;
    case "soc2": contractEvidence.soc2 = booleanValue; break;
    case "iso27001": contractEvidence.iso27001 = booleanValue; break;
    case "fedramp-eligible": contractEvidence.fedrampEligible = booleanValue; break;
    case "service-provider-oversight-reviewed-at": contractEvidence.serviceProviderOversightReviewedAt = stringValue; break;
    case "student-data-terms-reviewed-at": contractEvidence.studentDataTermsReviewedAt = stringValue; break;
    case "financial-customer-info-reviewed-at": contractEvidence.financialCustomerInfoReviewedAt = stringValue; break;
  }
}

/**
 * Resolve evidence only inside one configured connection boundary. Values on
 * the connection row are treated as declarations until a current evidence row
 * for that exact connection and claim validates them.
 */
export function resolveProviderTrustEvidence(input: {
  connection: ProviderConnectionPosture;
  /** DB identity used by evidence rows; defaults to the semantic connection id for pure callers. */
  evidenceConnectionId?: string;
  records: ProviderTrustEvidenceRecord[];
  now?: Date;
  requiredClaims?: ProviderTrustClaimKey[];
  supplierContract?: CurrentSupplierContract;
}): ProviderTrustEvidenceResolution {
  const now = input.now ?? new Date();
  const scoped = input.records.filter(
    (record) => record.providerConnectionId === (input.evidenceConnectionId ?? input.connection.providerConnectionId) && isClaimKey(record.claimKey),
  );
  const claimKeys: ProviderTrustClaimKey[] = input.requiredClaims
    ?? [...new Set(scoped.map((record) => record.claimKey as ProviderTrustClaimKey))].sort();
  const contractEvidence: ProviderContractEvidence = {};
  const entitlements: ProviderEntitlements = {};
  const resolved = claimKeys.map((claimKey) => classifyClaim(
    claimKey,
    scoped.filter((record) => record.claimKey === claimKey),
    now,
  ));

  for (const result of resolved) {
    if (result.accepted) applyClaim(result.summary.claimKey, result.accepted.assertedValue, contractEvidence, entitlements);
  }

  const validContractEvidence = resolved.some(
    (result) => result.accepted?.evidenceType === "provider-contract",
  );
  if (validContractEvidence && contractIsCurrent(input.supplierContract, now)) {
    contractEvidence.supplierContractId = input.supplierContract?.contractId;
  }

  const statuses = resolved.map((result) => result.summary.status);
  const evidenceStatus: ProviderConnectionPosture["evidenceStatus"] =
    statuses.some((status) => status === "conflicting" || status === "rejected")
      ? "rejected"
      : statuses.some((status) => status === "valid")
        ? validContractEvidence ? "contract-uploaded" : "operator-attested"
        : statuses.some((status) => status === "expired")
          ? "expired"
          : "unreviewed";
  const acceptedDates = resolved
    .map((result) => result.accepted?.collectedAt)
    .filter((date): date is Date => Boolean(date));

  return {
    posture: {
      ...input.connection,
      contractEvidence,
      entitlements,
      evidenceStatus,
      lastReviewedAt: acceptedDates.length > 0
        ? new Date(Math.max(...acceptedDates.map((date) => date.getTime()))).toISOString()
        : null,
    },
    claims: resolved.map((result) => result.summary),
    hasActionRequired: statuses.some((status) => status !== "valid"),
  };
}

export type ProviderSuitabilityRouteReceipt = {
  schemaVersion: "provider-suitability-route-receipt/v1";
  policyId: string;
  compilerVersion: string;
  inputVersion: string;
  connectionRef: string;
  executionChannel: ProviderConnectionPosture["executionChannel"];
  accountClass: ProviderConnectionPosture["accountClass"];
  selectedProviderId: string;
  selectedUnderlyingProviderId: string | null;
  excludedProviderIds: string[];
  obligations: null | {
    requireProviderAllowlist: boolean;
    requireProviderBlocklist: boolean;
    requireZdr: boolean;
    denyDataCollection: boolean;
    requireBoundedFallbacks: boolean;
    requiredRegion: string | null;
    approvedEndpointSlugs: string[];
    regionalProcessingEntitled: boolean;
    enabledRegions: string[];
    requiredBaseUrl: string | null;
  };
  explanationCodes: string[];
  createdAt: string;
};

function connectionRef(connectionId: string): string {
  return `connection-sha256:${createHash("sha256").update(connectionId).digest("hex").slice(0, 24)}`;
}

/** Build a deliberately allowlisted receipt; arbitrary request or evidence data cannot enter it. */
export function buildProviderSuitabilityRouteReceipt(input: {
  policy: ProviderSuitabilityPolicy;
  inputVersion: string;
  connection: ProviderConnectionPosture;
  selectedProviderId: string;
  selectedUnderlyingProviderId?: string | null;
  excludedProviderIds: string[];
  createdAt?: Date;
}): ProviderSuitabilityRouteReceipt {
  return {
    schemaVersion: "provider-suitability-route-receipt/v1",
    policyId: input.policy.policyId,
    compilerVersion: input.policy.compilerVersion,
    inputVersion: input.inputVersion,
    connectionRef: connectionRef(input.connection.providerConnectionId),
    executionChannel: input.connection.executionChannel,
    accountClass: input.connection.accountClass,
    selectedProviderId: input.selectedProviderId,
    selectedUnderlyingProviderId: input.selectedUnderlyingProviderId ?? null,
    excludedProviderIds: sortedUnique([...input.excludedProviderIds, ...input.policy.deniedProviders]),
    obligations: input.policy.openRouterObligations ? {
      requireProviderAllowlist: input.policy.openRouterObligations.requireProviderAllowlist,
      requireProviderBlocklist: input.policy.openRouterObligations.requireProviderBlocklist,
      requireZdr: input.policy.openRouterObligations.requireZdr,
      denyDataCollection: input.policy.openRouterObligations.denyDataCollection,
      requireBoundedFallbacks: input.policy.openRouterObligations.requireBoundedFallbacks,
      requiredRegion: input.policy.openRouterObligations.requiredRegion,
      approvedEndpointSlugs: [...input.policy.openRouterObligations.approvedEndpointSlugs],
      regionalProcessingEntitled: input.policy.openRouterObligations.regionalProcessingEntitled,
      enabledRegions: [...input.policy.openRouterObligations.enabledRegions],
      requiredBaseUrl: input.policy.openRouterObligations.requiredBaseUrl,
    } : null,
    explanationCodes: sortedUnique(input.policy.explanations.map((explanation) => explanation.code)),
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
}

/**
 * Append a new account-scoped evidence revision and supersede older active
 * revisions for the same claim. A partial failure leaves contradictory active
 * revisions, which the resolver deliberately classifies as conflicting.
 */
export async function recordProviderTrustEvidence(input: {
  providerConnectionDbId: string;
  claimKey: ProviderTrustClaimKey;
  assertedValue: Prisma.InputJsonValue;
  evidenceType: "provider-operator-attestation" | "provider-contract" | "provider-assurance";
  title: string;
  description: string;
  collectedAt?: Date;
  validFrom?: Date | null;
  expiresAt: Date;
}): Promise<{ evidenceId: string }> {
  const { prisma } = await import("@dpf/db");
  const collectedAt = input.collectedAt ?? new Date();
  const evidenceId = `provider-trust:${input.providerConnectionDbId}:${input.claimKey}:${randomUUID()}`;
  const created = await prisma.complianceEvidence.create({
    data: {
      evidenceId,
      title: input.title,
      evidenceType: input.evidenceType,
      description: input.description,
      providerConnectionId: input.providerConnectionDbId,
      claimKey: input.claimKey,
      assertedValue: input.assertedValue,
      status: "active",
      collectedAt,
      validFrom: input.validFrom ?? collectedAt,
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });
  await prisma.complianceEvidence.updateMany({
    where: {
      providerConnectionId: input.providerConnectionDbId,
      claimKey: input.claimKey,
      status: "active",
      id: { not: created.id },
    },
    data: { status: "superseded", supersededById: created.id },
  });
  return { evidenceId };
}

export async function supersedeProviderTrustEvidenceClaim(input: {
  providerConnectionDbId: string;
  claimKey: ProviderTrustClaimKey;
}): Promise<void> {
  const { prisma } = await import("@dpf/db");
  await prisma.complianceEvidence.updateMany({
    where: {
      providerConnectionId: input.providerConnectionDbId,
      claimKey: input.claimKey,
      status: "active",
    },
    data: { status: "superseded" },
  });
}
