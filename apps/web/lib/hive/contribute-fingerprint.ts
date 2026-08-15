import { createHash } from "node:crypto";
import {
  prisma,
} from "@dpf/db";
import {
  buildFingerprintContribution,
  type ContributableRule,
} from "@dpf/db/device-fingerprint-contribution";
import {
  buildLedgerEntry,
  isContributionEnabled,
  type HiveContributionConfig,
} from "@dpf/db/hive-contribution-settings";
import { getDisplayPseudonym } from "@/lib/integrate/identity-privacy";

/**
 * The single entry point that contributes a resolved device fingerprint to the
 * hive — honoring the §6.1 consent surface (the device-fingerprint opt-in + the
 * master pause) and recording the contribution in the one ledger.
 *
 * Fail-closed: redaction runs inside buildFingerprintContribution; any
 * blocked_sensitive aborts. The actual cross-install transport
 * (contribute_to_hive) is driven by the curation pipeline; this records the
 * vetted, PII-free intent + ledger entry that the pipeline picks up.
 */
export type ContributeFingerprintResult = {
  contributed: boolean;
  reason: string;
  ledgerId?: string;
};

export type FingerprintContributionClient = {
  platformDevConfig: {
    findUnique(args: unknown): Promise<{
      deviceFingerprintOptIn: boolean;
      hiveContributionsPaused: boolean;
      contributionMode: string;
    } | null>;
  };
  hiveContributionLedger: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
};

export async function contributeDeviceFingerprint(
  rule: ContributableRule,
  options: { db?: FingerprintContributionClient; contributor?: string } = {},
): Promise<ContributeFingerprintResult> {
  const db = options.db ?? (prisma as unknown as FingerprintContributionClient);
  const row = await db.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { deviceFingerprintOptIn: true, hiveContributionsPaused: true, contributionMode: true },
  });
  const config: HiveContributionConfig = {
    deviceFingerprintOptIn: row?.deviceFingerprintOptIn ?? true,
    hiveContributionsPaused: row?.hiveContributionsPaused ?? false,
    contributionMode: row?.contributionMode ?? "selective",
  };

  if (!isContributionEnabled("device_fingerprint", config)) {
    return { contributed: false, reason: "contribution_disabled" };
  }

  const contributor = options.contributor ?? await getDisplayPseudonym().catch(() => "dpf-anon");
  const result = buildFingerprintContribution(rule, { optIn: true, contributor });
  if (result.status !== "ready") {
    return { contributed: false, reason: result.status };
  }

  const payloadHash = createHash("sha256").update(JSON.stringify(result.payload)).digest("hex").slice(0, 16);
  const existing = await db.hiveContributionLedger.findFirst({
    where: { contributionType: "device_fingerprint", payloadHash },
    select: { id: true },
  });
  if (existing) return { contributed: false, reason: "already_submitted", ledgerId: existing.id };

  const entry = await db.hiveContributionLedger.create({
    data: {
      ...buildLedgerEntry({
      contributionType: "device_fingerprint",
      contributor,
      ruleKey: rule.ruleKey,
      summary: `${result.payload.resolvedIdentity.name} → ${result.payload.taxonomyNodeId ?? "unplaced"}`,
      payloadHash,
      redactionStatus: result.redactedFields.length > 0 ? "redacted" : "not_required",
      }),
      // Retain the privacy-filtered rule body; a hash-only ledger cannot be
      // curated or delivered to another install. resultBundle is the existing
      // generic JSON carriage field, so this adds no parallel store.
      resultBundle: result.payload,
      deliveryStatus: "queued",
    },
  });

  return { contributed: true, reason: "ready", ledgerId: entry.id };
}

/** Submit every locally-created active/global rule once. Seed rules already
 * ship to every install, while draft/shadow/local rules are not publication
 * ready and must never cross the boundary automatically. */
export async function contributeEligibleFingerprintRules(): Promise<{
  eligible: number;
  contributed: number;
  skipped: number;
}> {
  const rules = await prisma.discoveryFingerprintRule.findMany({
    where: { status: "active", scope: "global", source: { not: "seed" } },
    select: {
      ruleKey: true,
      requiredEvidenceFamilies: true,
      matchExpression: true,
      resolvedIdentity: true,
      identityConfidence: true,
      taxonomyConfidence: true,
      taxonomyNode: { select: { nodeId: true } },
    },
  });
  let contributed = 0;
  for (const row of rules) {
    const result = await contributeDeviceFingerprint({
      ruleKey: row.ruleKey,
      requiredEvidenceFamilies: row.requiredEvidenceFamilies,
      matchExpression: row.matchExpression as ContributableRule["matchExpression"],
      resolvedIdentity: row.resolvedIdentity as ContributableRule["resolvedIdentity"],
      taxonomyNodeId: row.taxonomyNode?.nodeId ?? null,
      identityConfidence: row.identityConfidence,
      taxonomyConfidence: row.taxonomyConfidence,
    });
    if (result.contributed) contributed++;
  }
  return { eligible: rules.length, contributed, skipped: rules.length - contributed };
}
