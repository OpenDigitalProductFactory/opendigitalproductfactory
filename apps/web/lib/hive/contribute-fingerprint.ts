import { createHash } from "node:crypto";
import {
  prisma,
  buildFingerprintContribution,
  buildLedgerEntry,
  isContributionEnabled,
  type ContributableRule,
  type HiveContributionConfig,
} from "@dpf/db";
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

export async function contributeDeviceFingerprint(rule: ContributableRule): Promise<ContributeFingerprintResult> {
  const row = await prisma.platformDevConfig.findUnique({
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

  const contributor = await getDisplayPseudonym().catch(() => "dpf-anon");
  const result = buildFingerprintContribution(rule, { optIn: true, contributor });
  if (result.status !== "ready") {
    return { contributed: false, reason: result.status };
  }

  const payloadHash = createHash("sha256").update(JSON.stringify(result.payload)).digest("hex").slice(0, 16);
  const entry = await prisma.hiveContributionLedger.create({
    data: buildLedgerEntry({
      contributionType: "device_fingerprint",
      contributor,
      ruleKey: rule.ruleKey,
      summary: `${result.payload.resolvedIdentity.name} → ${result.payload.taxonomyNodeId ?? "unplaced"}`,
      payloadHash,
      redactionStatus: result.redactedFields.length > 0 ? "redacted" : "not_required",
    }),
  });

  return { contributed: true, reason: "ready", ledgerId: entry.id };
}
