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
    createdAt: string;
  }>;
  seedReviews: SeedContributionReviewRow[];
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

  const [ledgerRows, featurePacks] = await Promise.all([
    prisma.hiveContributionLedger.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.featurePack.findMany({
      where: { reviewedAt: { not: null } },
      orderBy: { reviewedAt: "desc" },
      take: 50,
      select: {
        packId: true,
        title: true,
        prUrl: true,
        prNumber: true,
        mergeReadiness: true,
        reviewedAt: true,
        manifest: true,
        reviewReport: true,
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
    createdAt: Date;
  };

  return {
    config,
    statuses: resolveHiveContributionStatuses(config),
    contributor,
    ledger: (ledgerRows as LedgerRow[]).map((r: LedgerRow) => ({
      id: r.id,
      contributionType: r.contributionType,
      contributor: r.contributor,
      ruleKey: r.ruleKey,
      summary: r.summary,
      status: r.status,
      redactionStatus: r.redactionStatus,
      createdAt: r.createdAt.toISOString(),
    })),
    seedReviews: featurePacks.map(toSeedReview).filter((row): row is SeedContributionReviewRow => row !== null),
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
