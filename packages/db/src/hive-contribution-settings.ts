/**
 * Hive contribution consent resolution (spec §6.1).
 *
 * One surface governs every contribution type. This module is the pure logic
 * behind it: given the persisted PlatformDevConfig flags, decide whether a given
 * contribution type may currently flow to the hive. The master pause overrides
 * everything; per-type opt-ins gate the rest.
 *
 * Device fingerprints are opt-in DEFAULTED ON (PII-free, redaction fail-closed).
 * Source/improvement contributions follow the existing contributionMode policy
 * (fork_only = off; selective | contribute_all = on).
 *
 * Pure/testable — the server actions + the Phase-6 contribution path call this
 * so the toggle is honored in exactly one place.
 */

export type HiveContributionType = "device_fingerprint" | "source" | "improvement";

export const HIVE_CONTRIBUTION_TYPES: readonly HiveContributionType[] = [
  "device_fingerprint",
  "source",
  "improvement",
];

/** The persisted consent inputs (a subset of PlatformDevConfig). */
export type HiveContributionConfig = {
  deviceFingerprintOptIn: boolean;
  hiveContributionsPaused: boolean;
  /** "fork_only" | "selective" | "contribute_all" */
  contributionMode: string;
};

export type HiveContributionTypeStatus = {
  type: HiveContributionType;
  /** The per-type preference, ignoring the master pause. */
  optedIn: boolean;
  /** The effective decision: opted in AND not master-paused. */
  enabled: boolean;
  /** Plain-language statement of exactly what leaves the install. */
  description: string;
};

const DESCRIPTIONS: Record<HiveContributionType, string> = {
  device_fingerprint:
    "PII-stripped device fingerprint → identity → portfolio placement. Never your MAC, IP, hostname, or SSID.",
  source: "Code, builds, and improvement proposals contributed via pull request with DCO sign-off.",
  improvement: "Improvement proposals and platform learnings shared back to the hive.",
};

/** Per-type opt-in, before the master pause is applied. */
export function isTypeOptedIn(type: HiveContributionType, config: HiveContributionConfig): boolean {
  switch (type) {
    case "device_fingerprint":
      return config.deviceFingerprintOptIn;
    case "source":
    case "improvement":
      // Existing source/improvement policy: anything other than fork-only is opted in.
      return config.contributionMode !== "fork_only";
  }
}

/**
 * The effective decision for a type: opted in AND the master pause is off.
 * This is the single gate the contribution paths must consult.
 */
export function isContributionEnabled(type: HiveContributionType, config: HiveContributionConfig): boolean {
  if (config.hiveContributionsPaused) {
    return false;
  }
  return isTypeOptedIn(type, config);
}

/** Full per-type status list for the consent UI. */
export function resolveHiveContributionStatuses(config: HiveContributionConfig): HiveContributionTypeStatus[] {
  return HIVE_CONTRIBUTION_TYPES.map((type) => ({
    type,
    optedIn: isTypeOptedIn(type, config),
    enabled: isContributionEnabled(type, config),
    description: DESCRIPTIONS[type],
  }));
}

export type HiveLedgerEntryInput = {
  contributionType: HiveContributionType;
  contributor: string;
  ruleKey?: string | null;
  summary: string;
  payloadHash?: string | null;
  redactionStatus?: string | null;
};

/** Shape a ledger row payload (status starts "submitted"). */
export function buildLedgerEntry(input: HiveLedgerEntryInput): Record<string, unknown> {
  return {
    contributionType: input.contributionType,
    contributor: input.contributor,
    ruleKey: input.ruleKey ?? null,
    summary: input.summary,
    payloadHash: input.payloadHash ?? null,
    redactionStatus: input.redactionStatus ?? null,
    status: "submitted",
  };
}
