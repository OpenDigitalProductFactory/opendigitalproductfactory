"use server";

import {
  prisma,
  resolveHiveContributionStatuses,
  type HiveContributionConfig,
  type HiveContributionTypeStatus,
} from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { getDisplayPseudonym } from "@/lib/integrate/identity-privacy";
import {
  findCanonicalSeedContentPaths,
  SEED_CONTRIBUTION_FIT_DECISIONS,
  type SeedContributionFitDecision,
  type SeedDistributionScope,
} from "@/lib/integrate/seed-contribution-fit";
import { revalidatePath } from "next/cache";
import { deliverHiveResultToConfiguredForge } from "@/lib/hive/result-store";
import { resolvePrincipalIdForUser } from "@/lib/identity/principal-linking";

async function requireManagePlatform(): Promise<string> {
  return (await requireCapability("manage_platform")).userId;
}

const HIVE_PATH = "/admin/hive";

const DEFAULT_CONFIG: HiveContributionConfig = {
  deviceFingerprintOptIn: true,
  hiveContributionsPaused: false,
  contributionMode: "private",
};

export type HiveContributionsView = {
  config: HiveContributionConfig;
  statuses: HiveContributionTypeStatus[];
  contributor: string | null;
  ledger: Array<{
    id: string;
    contributionType: string;
    contributor: string;
    ruleKey: string | null;
    summary: string;
    status: string;
    redactionStatus: string | null;
    deliveryStatus: string;
    deliveryAttempts: number;
    deliveryRemoteRef: string | null;
    deliveryError: string | null;
    createdAt: string;
  }>;
  seedReviews: SeedContributionReviewRow[];
  contributionProvenance: ContributionProvenanceRow[];
};

export type ContributionProvenanceAxis = {
  status: string;
  label: string;
  detail: string;
  url?: string;
};

export type ContributionProvenanceRow = {
  id: string;
  source: "feature-pack" | "improvement-proposal" | "hive-ledger";
  title: string;
  sourceLabel: string;
  occurredAt: string;
  localAvailability: ContributionProvenanceAxis;
  privacyDisposition: ContributionProvenanceAxis;
  publication: ContributionProvenanceAxis;
  upstreamAcceptance: ContributionProvenanceAxis;
};

export type SeedContributionReviewRow = {
  packId: string;
  title: string;
  decision: SeedContributionFitDecision | null;
  distributionScope: SeedDistributionScope | null;
  applicableScope: string[];
  mergeEligible: boolean;
  mergeReadiness: string | null;
  changedSeedPaths: string[];
  rationale: string;
  prUrl: string | null;
  prNumber: number | null;
  reviewedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

const seedFitDecisions = new Set<string>(SEED_CONTRIBUTION_FIT_DECISIONS);
const distributionScopes = new Set<string>(["global-default", "archetype-scoped", "vertical-scoped"]);

function toSeedReview(row: {
  packId: string;
  title: string;
  prUrl: string | null;
  prNumber: number | null;
  mergeReadiness: string | null;
  reviewedAt: Date | null;
  manifest: unknown;
  reviewReport: unknown;
}): SeedContributionReviewRow | null {
  if (!row.reviewedAt) return null;

  const manifest = asRecord(row.manifest);
  const report = asRecord(row.reviewReport);
  const seedFit = asRecord(report?.seedFit);
  const manifestPaths = [
    ...stringArray(manifest?.files),
    ...stringArray(manifest?.migrations),
    ...stringArray(manifest?.schemaChanges),
  ];
  const reviewedPaths = stringArray(seedFit?.changedSeedPaths);
  const changedSeedPaths = reviewedPaths.length > 0
    ? findCanonicalSeedContentPaths(reviewedPaths)
    : findCanonicalSeedContentPaths(manifestPaths);
  if (changedSeedPaths.length === 0) return null;

  const rawDecision = typeof seedFit?.decision === "string" ? seedFit.decision : null;
  const decision = rawDecision && seedFitDecisions.has(rawDecision)
    ? rawDecision as SeedContributionFitDecision
    : null;
  const rawDistributionScope = typeof seedFit?.distributionScope === "string"
    ? seedFit.distributionScope
    : null;
  const distributionScope = rawDistributionScope && distributionScopes.has(rawDistributionScope)
    ? rawDistributionScope as SeedDistributionScope
    : null;
  const applicableScope = decision === "archetype-scoped"
    ? stringArray(seedFit?.applicableArchetypeCategories)
    : decision === "vertical-scoped"
      ? stringArray(seedFit?.applicableVerticals)
      : [];

  return {
    packId: row.packId,
    title: row.title,
    decision,
    distributionScope,
    applicableScope,
    mergeEligible: decision !== null && seedFit?.mergeEligible === true,
    mergeReadiness: row.mergeReadiness,
    changedSeedPaths,
    rationale: typeof seedFit?.rationale === "string"
      ? seedFit.rationale
      : "Seed-fit evidence is unavailable; review is required.",
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    reviewedAt: row.reviewedAt.toISOString(),
  };
}

function sentToCommunityAxis(prUrl: string, prNumber: number | null): ContributionProvenanceAxis {
  return {
    status: "sent-community",
    label: "Sent to community project",
    detail: prNumber ? `PR #${prNumber}` : "Public contribution PR recorded.",
    url: prUrl,
  };
}

function upstreamAxisFromLedgerStatus(status: string): ContributionProvenanceAxis {
  switch (status) {
    case "accepted":
      return { status: "accepted", label: "Accepted by community", detail: "The community ledger marks this contribution accepted." };
    case "rejected":
      return { status: "rejected", label: "Rejected", detail: "The community ledger marks this contribution rejected." };
    case "withdrawn":
      return { status: "withdrawn", label: "Withdrawn", detail: "The contribution was withdrawn." };
    case "curating":
    case "submitted":
      return { status: "under-review", label: "Under review", detail: "The community project has not accepted it yet." };
    default:
      return { status: "needs-review", label: "Needs provenance review", detail: `Ledger status is ${status}.` };
  }
}

function upstreamAxisFromFeaturePackReview(mergeReadiness: string | null | undefined): ContributionProvenanceAxis {
  if (mergeReadiness === "needs-work" || mergeReadiness === "blocked") {
    return {
      status: "needs-changes",
      label: "Needs changes",
      detail: "Contribution review found work that must be addressed before acceptance.",
    };
  }

  return {
    status: "under-review",
    label: "Under review",
    detail: "The community project has not accepted it yet.",
  };
}

function featurePackProvenance(row: {
  packId: string;
  title: string;
  status?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  mergeReadiness?: string | null;
  reviewedAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  manifest: unknown;
}): ContributionProvenanceRow {
  const manifest = asRecord(row.manifest);
  const prUrl = firstString(row.prUrl, manifest?.prUrl);
  const prNumber = firstNumber(row.prNumber, manifest?.prNumber);
  const rawStatus = row.status ?? "local";
  const occurredAt = (row.updatedAt ?? row.reviewedAt ?? row.createdAt ?? new Date(0)).toISOString();

  const localAvailability: ContributionProvenanceAxis = {
    status: "saved-locally",
    label: "Saved locally",
    detail: "Feature Pack exists on this install.",
  };

  if (prUrl) {
    return {
      id: `feature-pack:${row.packId}`,
      source: "feature-pack",
      title: row.title,
      sourceLabel: "Feature Pack",
      occurredAt,
      localAvailability,
      privacyDisposition: {
        status: "approved-to-share",
        label: "Approved to share",
        detail: "A public community contribution record exists for this Feature Pack.",
      },
      publication: sentToCommunityAxis(prUrl, prNumber),
      upstreamAcceptance: upstreamAxisFromFeaturePackReview(row.mergeReadiness),
    };
  }

  if (rawStatus === "contributed") {
    return {
      id: `feature-pack:${row.packId}`,
      source: "feature-pack",
      title: row.title,
      sourceLabel: "Feature Pack",
      occurredAt,
      localAvailability,
      privacyDisposition: {
        status: "approved-to-share",
        label: "Approved to share",
        detail: "Legacy Feature Pack status says contributed.",
      },
      publication: {
        status: "needs-attention",
        label: "Needs attention",
        detail: "Marked contributed, but no sent-community proof was found.",
      },
      upstreamAcceptance: {
        status: "needs-review",
        label: "Needs provenance review",
        detail: "Legacy status cannot prove whether the community accepted it.",
      },
    };
  }

  return {
    id: `feature-pack:${row.packId}`,
    source: "feature-pack",
    title: row.title,
    sourceLabel: "Feature Pack",
    occurredAt,
    localAvailability,
    privacyDisposition: {
      status: "kept-here",
      label: "Kept on this system",
      detail: "No public contribution evidence was found.",
    },
    publication: {
      status: "not-queued",
      label: "Not queued",
      detail: "Nothing has been sent outside this install.",
    },
    upstreamAcceptance: {
      status: "not-sent",
      label: "Not sent",
      detail: "No community review exists.",
    },
  };
}

function improvementProposalProvenance(row: {
  proposalId: string;
  title: string;
  contributionStatus: string;
  createdAt: Date;
  updatedAt: Date;
}): ContributionProvenanceRow {
  const shared = row.contributionStatus === "contributed";
  return {
    id: `improvement-proposal:${row.proposalId}`,
    source: "improvement-proposal",
    title: row.title,
    sourceLabel: "Improvement proposal",
    occurredAt: row.updatedAt.toISOString(),
    localAvailability: {
      status: "saved-locally",
      label: "Saved locally",
      detail: "Improvement proposal exists on this install.",
    },
    privacyDisposition: shared
      ? { status: "approved-to-share", label: "Approved to share", detail: "Proposal status says it was contributed." }
      : { status: "kept-here", label: "Kept on this system", detail: "Proposal has not been contributed." },
    publication: shared
      ? { status: "sent-community", label: "Sent to community project", detail: "Contribution status says it was sent; no PR URL is attached." }
      : { status: "not-queued", label: "Not queued", detail: "Nothing has been sent outside this install." },
    upstreamAcceptance: shared
      ? { status: "needs-review", label: "Needs provenance review", detail: "Legacy status does not prove community acceptance." }
      : { status: "not-sent", label: "Not sent", detail: "No community review exists." },
  };
}

function ledgerProvenance(row: {
  id: string;
  contributionType: string;
  summary: string;
  status: string;
  redactionStatus: string | null;
  createdAt: Date;
}): ContributionProvenanceRow {
  return {
    id: `hive-ledger:${row.id}`,
    source: "hive-ledger",
    title: row.summary,
    sourceLabel: row.contributionType,
    occurredAt: row.createdAt.toISOString(),
    localAvailability: {
      status: "saved-locally",
      label: "Saved locally",
      detail: "Ledger record is stored on this install.",
    },
    privacyDisposition: {
      status: row.redactionStatus === "blocked" ? "blocked-private-path" : "private-parts-removed",
      label: row.redactionStatus === "blocked" ? "Blocked by policy" : "Private parts removed",
      detail: row.redactionStatus ?? "Ledger contribution passed through the redaction boundary.",
    },
    publication: {
      status: "sent-community",
      label: "Sent to community project",
      detail: "Hive ledger contains a public contribution record.",
    },
    upstreamAcceptance: upstreamAxisFromLedgerStatus(row.status),
  };
}

export async function getHiveContributionsView(): Promise<HiveContributionsView> {
  const row = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { deviceFingerprintOptIn: true, hiveContributionsPaused: true, contributionMode: true },
  });
  const config: HiveContributionConfig = {
    deviceFingerprintOptIn: row?.deviceFingerprintOptIn ?? DEFAULT_CONFIG.deviceFingerprintOptIn,
    hiveContributionsPaused: row?.hiveContributionsPaused ?? DEFAULT_CONFIG.hiveContributionsPaused,
    contributionMode: row?.contributionMode ?? DEFAULT_CONFIG.contributionMode,
  };

  const contributor = await getDisplayPseudonym().catch(() => null);

  const [ledgerRows, featurePacks, improvementProposals] = await Promise.all([
    prisma.hiveContributionLedger.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.featurePack.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        packId: true,
        title: true,
        status: true,
        prUrl: true,
        prNumber: true,
        mergeReadiness: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        manifest: true,
        reviewReport: true,
      },
    }),
    prisma.improvementProposal.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        proposalId: true,
        title: true,
        contributionStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  type LedgerRow = {
    id: string;
    contributionType: string;
    contributor: string;
    ruleKey: string | null;
    summary: string;
    status: string;
    redactionStatus: string | null;
    deliveryStatus: string;
    deliveryAttempts: number;
    deliveryRemoteRef: string | null;
    deliveryError: string | null;
    createdAt: Date;
  };

  const ledger = (ledgerRows as LedgerRow[]).map((r: LedgerRow) => ({
    id: r.id,
    contributionType: r.contributionType,
    contributor: r.contributor,
    ruleKey: r.ruleKey,
    summary: r.summary,
    status: r.status,
    redactionStatus: r.redactionStatus,
    deliveryStatus: r.deliveryStatus,
    deliveryAttempts: r.deliveryAttempts,
    deliveryRemoteRef: r.deliveryRemoteRef,
    deliveryError: r.deliveryError,
    createdAt: r.createdAt.toISOString(),
  }));

  const contributionProvenance = [
    ...(featurePacks as Parameters<typeof featurePackProvenance>[0][]).map(featurePackProvenance),
    ...(improvementProposals as Parameters<typeof improvementProposalProvenance>[0][]).map(improvementProposalProvenance),
    ...(ledgerRows as LedgerRow[]).map(ledgerProvenance),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return {
    config,
    statuses: resolveHiveContributionStatuses(config),
    contributor,
    ledger,
    seedReviews: featurePacks.map(toSeedReview).filter((row): row is SeedContributionReviewRow => row !== null),
    contributionProvenance,
  };
}

export async function setDeviceFingerprintOptIn(enabled: boolean): Promise<void> {
  const userId = await requireManagePlatform();
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: { deviceFingerprintOptIn: enabled, configuredAt: new Date(), configuredById: userId },
    create: { id: "singleton", deviceFingerprintOptIn: enabled, configuredById: userId },
  });
  revalidatePath(HIVE_PATH);
}

export async function setHiveContributionsPaused(paused: boolean): Promise<void> {
  const userId = await requireManagePlatform();
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: { hiveContributionsPaused: paused, configuredAt: new Date(), configuredById: userId },
    create: { id: "singleton", hiveContributionsPaused: paused, configuredById: userId },
  });
  revalidatePath(HIVE_PATH);
}

export async function reviewHiveResultAction(input: {
  id: string;
  decision: "accepted" | "rejected";
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const userId = await requireManagePlatform();
  const principalId = (await resolvePrincipalIdForUser(userId)) ?? userId;
  const row = await prisma.hiveContributionLedger.findUnique({
    where: { id: input.id },
    select: { id: true, contributionType: true },
  });
  if (!row || row.contributionType !== "result") return { ok: false, error: "Hive result was not found." };
  await prisma.hiveContributionLedger.update({
    where: { id: row.id },
    data: {
      status: input.decision,
      reviewedByPrincipalId: principalId,
      deliveryStatus: input.decision === "accepted" ? "queued" : "not-requested",
    },
  });
  if (input.decision === "accepted") await deliverHiveResultToConfiguredForge(row.id);
  revalidatePath(HIVE_PATH);
  return { ok: true, message: input.decision === "accepted" ? "Accepted; forge delivery was attempted independently." : "Result rejected." };
}

export async function retryHiveResultDeliveryAction(id: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requireManagePlatform();
  try {
    const result = await deliverHiveResultToConfiguredForge(id);
    revalidatePath(HIVE_PATH);
    return { ok: true, message: result.status === "delivered" ? "Delivered to the configured forge." : "Delivery remains queued for retry." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to retry delivery." };
  }
}
