"use server";

import {
  prisma,
  resolveHiveContributionStatuses,
  type HiveContributionConfig,
  type HiveContributionTypeStatus,
} from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getDisplayPseudonym } from "@/lib/integrate/identity-privacy";
import { revalidatePath } from "next/cache";

async function requireManagePlatform(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

const HIVE_PATH = "/admin/hive";

const DEFAULT_CONFIG: HiveContributionConfig = {
  deviceFingerprintOptIn: true,
  hiveContributionsPaused: false,
  contributionMode: "selective",
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
};

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

  const ledgerRows = await prisma.hiveContributionLedger.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

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
