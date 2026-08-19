// EP-GOLDEN-TRIANGLE Slice 7 (BI-6E01FE69) — federated hive contribution of
// learned posture defaults.
//
// A learned posture default is a platform LEARNING (the WWWD lane of the Learning
// Commons), so it rides the EXISTING "improvement" contribution type through the
// one consent gate (isContributionEnabled) and the one ledger
// (HiveContributionLedger) — pseudonymously and PII-free, with no new substrate
// and no schema change. What leaves the install is only the anonymized posture
// (preset + weights); never an org id, name, or any identifier.
//
// Aggregation of peer-contributed postures into a consensus is pure and ready for
// when the federated ingest supplies peer data; the suggestion read/store seam
// rides the platform profile's autonomyPolicy JSON (migration-free). Until a
// federation of installs feeds postures back, getHivePostureSuggestion() returns
// null — the cross-install transport is hive-network infrastructure, external to
// a single install.
import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";
import { buildLedgerEntry, isContributionEnabled, type HiveContributionConfig } from "@dpf/db/hive-contribution-settings";

import type { GoldenTrianglePreference, GoldenTrianglePreset } from "@/lib/golden-triangle";
import { getDisplayPseudonym } from "@/lib/build/identity-privacy";

const PLATFORM_PROFILE_ID = "mark-dpf-platform";
const PRESETS: GoldenTrianglePreset[] = ["fast", "frugal", "assured", "balanced", "custom"];

// ─── Anonymization ───────────────────────────────────────────────────────────

/** Exactly what may leave the install — the posture shape, nothing identifying. */
export interface AnonymizedPosture {
  preset: GoldenTrianglePreset;
  qualityWeight: number;
  costWeight: number;
  timeWeight: number;
}

export function anonymizePosture(p: GoldenTrianglePreference): AnonymizedPosture {
  return { preset: p.preset, qualityWeight: p.qualityWeight, costWeight: p.costWeight, timeWeight: p.timeWeight };
}

// ─── Contribution (outbound) ─────────────────────────────────────────────────

export interface ContributePostureResult {
  contributed: boolean;
  reason: string;
  ledgerId?: string;
}

/** Structural client for the contribution path — satisfied by PrismaClient + test fakes. */
export interface HiveContributeClient {
  platformDevConfig: {
    findUnique: (args: unknown) => Promise<{
      deviceFingerprintOptIn: boolean;
      hiveContributionsPaused: boolean;
      contributionMode: string;
    } | null>;
  };
  hiveContributionLedger: {
    create: (args: { data: unknown }) => Promise<{ id: string }>;
  };
}

/**
 * Contribute a posture default to the hive, honoring the §6.1 consent surface
 * (the "improvement" opt-in via contributionMode + the master pause). Fail-closed:
 * returns { contributed:false } when contribution is disabled. Only the anonymized
 * posture is hashed into the ledger; the cross-install transport is the curation
 * pipeline. Safe to fire-and-forget after a save.
 */
export async function contributePostureDefault(
  preference: GoldenTrianglePreference,
  db?: HiveContributeClient,
): Promise<ContributePostureResult> {
  const client = db ?? (prisma as unknown as HiveContributeClient);
  try {
    const row = await client.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { deviceFingerprintOptIn: true, hiveContributionsPaused: true, contributionMode: true },
    });
    const config: HiveContributionConfig = {
      deviceFingerprintOptIn: row?.deviceFingerprintOptIn ?? true,
      hiveContributionsPaused: row?.hiveContributionsPaused ?? false,
      contributionMode: row?.contributionMode ?? "selective",
    };
    if (!isContributionEnabled("improvement", config)) {
      return { contributed: false, reason: "contribution_disabled" };
    }
    const contributor = await getDisplayPseudonym().catch(() => "dpf-anon");
    const payload = anonymizePosture(preference);
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
    const entry = await client.hiveContributionLedger.create({
      data: buildLedgerEntry({
        contributionType: "improvement",
        contributor,
        ruleKey: `golden-triangle:posture:${preference.preset}`,
        summary: `Golden Triangle posture default → ${preference.preset}`,
        payloadHash,
        redactionStatus: "not_required", // a posture carries no PII
      }),
    });
    return { contributed: true, reason: "ready", ledgerId: entry.id };
  } catch {
    return { contributed: false, reason: "error" };
  }
}

// ─── Aggregation (pure) ──────────────────────────────────────────────────────

export interface HivePostureConsensus {
  /** The most-contributed preset across peers. */
  preset: GoldenTrianglePreset;
  /** Mean axis weights across peers (2dp). */
  qualityWeight: number;
  costWeight: number;
  timeWeight: number;
  /** How many peers informed the consensus. */
  peerCount: number;
  /** Share of peers on the winning preset (0–1, 2dp) — how strong the consensus is. */
  confidence: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Roll peer-contributed postures into a single consensus: the modal preset and
 * the mean axis weights, with a confidence = the winning preset's share. Pure +
 * deterministic (ties resolve to the first-seen preset). Returns null for an
 * empty set.
 */
export function aggregatePostureContributions(contributions: AnonymizedPosture[]): HivePostureConsensus | null {
  const n = contributions.length;
  if (n === 0) return null;

  const counts = new Map<GoldenTrianglePreset, number>();
  for (const c of contributions) counts.set(c.preset, (counts.get(c.preset) ?? 0) + 1);
  let preset = contributions[0].preset;
  let winnerCount = 0;
  for (const [p, count] of counts) {
    if (count > winnerCount) {
      preset = p;
      winnerCount = count;
    }
  }

  const sum = contributions.reduce(
    (a, c) => ({ q: a.q + c.qualityWeight, co: a.co + c.costWeight, t: a.t + c.timeWeight }),
    { q: 0, co: 0, t: 0 },
  );

  return {
    preset,
    qualityWeight: round2(sum.q / n),
    costWeight: round2(sum.co / n),
    timeWeight: round2(sum.t / n),
    peerCount: n,
    confidence: round2(winnerCount / n),
  };
}

// ─── Suggestion read/store seam (migration-free) ─────────────────────────────

/** Structural client for the suggestion seam — rides the platform profile JSON. */
export interface HiveSuggestionClient {
  decisionPerspectiveProfile: {
    findFirst: (args: unknown) => Promise<{ autonomyPolicy: unknown } | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function isConsensus(v: unknown): v is HivePostureConsensus {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.preset === "string" &&
    PRESETS.includes(o.preset as GoldenTrianglePreset) &&
    typeof o.qualityWeight === "number" &&
    typeof o.costWeight === "number" &&
    typeof o.timeWeight === "number" &&
    typeof o.peerCount === "number" &&
    typeof o.confidence === "number"
  );
}

/**
 * Read the hive-suggested posture consensus (the federated ingest writes it here).
 * Returns null until a federation supplies peer postures. Fail-open. This is a
 * SUGGESTION only — it never enters the resolution chain (org → platform →
 * Balanced); the priority surface may show it as "recommended by N peers."
 */
export async function getHivePostureSuggestion(db?: HiveSuggestionClient): Promise<HivePostureConsensus | null> {
  const client = db ?? (prisma as unknown as HiveSuggestionClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: { profileId: PLATFORM_PROFILE_ID },
      select: { autonomyPolicy: true },
    });
    const v = asRecord(row?.autonomyPolicy).hiveDefaultSuggestion;
    return isConsensus(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Persist a freshly-aggregated consensus for the suggestion surface. This is the
 * step the federated ingest calls once it has peer postures (aggregate → store).
 * Merge-preserving + fail-open, mirroring the posture persistence pattern.
 */
export async function storeHivePostureSuggestion(
  consensus: HivePostureConsensus,
  db?: HiveSuggestionClient,
): Promise<boolean> {
  const client = db ?? (prisma as unknown as HiveSuggestionClient);
  try {
    const row = await client.decisionPerspectiveProfile.findFirst({
      where: { profileId: PLATFORM_PROFILE_ID },
      select: { autonomyPolicy: true },
    });
    const nextPolicy = { ...asRecord(row?.autonomyPolicy), hiveDefaultSuggestion: consensus };
    const res = await client.decisionPerspectiveProfile.updateMany({
      where: { profileId: PLATFORM_PROFILE_ID },
      data: { autonomyPolicy: nextPolicy },
    });
    return res.count > 0;
  } catch {
    return false;
  }
}
