// Incumbent coverage assessment (BI-548060D5, D3; spec 2026-07-23 §5.2, §5.4).
//
// Turns the authored AbsorptionPosture matrix into a per-customer, evidenced
// coverage verdict for one incumbent application. This module owns the
// deterministic backbone: stage 1 (posture_matrix default) + stage 4 (human
// confirmation) + the typed accessor D6 consumes. Stages 2 (rule via taxonomy)
// and 3 (AI) are follow-on phases.
//
// verdict + status reuse the AbsorptionPosture vocabulary (deliberately identical
// — spec §5.2). assessedVia keeps provenance honest: a posture_matrix default is a
// starting position, never a claim, and must be distinguishable from
// human_confirmed (spec R3). Nothing reaches status=confirmed except through
// confirmCoverageAssessment. `db` is injected so the core is unit-testable
// without a live Prisma client.

import type { PrismaClient } from "../../generated/client/client";
import { ABSORPTION_VERDICTS, type AbsorptionVerdict } from "./absorption-posture";
import {
  normalizeAbsorptionIdentityKey,
  postureIdentityFromObservation,
  resolveAbsorptionPosture,
} from "./absorption-posture-resolver";
import { CATEGORY_BUSINESS_CAPABILITY_PERSPECTIVES } from "../business-capability-category-corpus";

export {
  normalizeAbsorptionIdentityKey,
  resolveAbsorptionPosture,
} from "./absorption-posture-resolver";

/** How a verdict was reached — provenance (spec §5.2). Closed enum. */
export const ASSESSMENT_VIA_METHODS = [
  "posture_matrix",
  "rule",
  "ai",
  "human_confirmed",
] as const;
export type AssessmentVia = (typeof ASSESSMENT_VIA_METHODS)[number];
export function isAssessmentVia(value: string): value is AssessmentVia {
  return (ASSESSMENT_VIA_METHODS as readonly string[]).includes(value);
}

/** Coverage verdict vocabulary is AbsorptionPosture's, unchanged (spec §5.2). */
export type CoverageVerdict = AbsorptionVerdict;
export function isCoverageVerdict(value: string): value is CoverageVerdict {
  return (ABSORPTION_VERDICTS as readonly string[]).includes(value);
}

/** One current assessment per incumbent — stable, deterministic id. */
export function assessmentIdFor(digitalProductId: string): string {
  return `assess-${normalizeAbsorptionIdentityKey(digitalProductId)}`;
}

/** The provider an incumbent DigitalProduct represents: the intake-recorded
 *  vendor (observationConfig.vendor) if present, else the product name. */
export function providerOfIncumbent(row: {
  name: string;
  observationConfig: unknown;
}): string {
  const cfg = row.observationConfig;
  if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
    const vendor = (cfg as Record<string, unknown>).vendor;
    if (typeof vendor === "string" && vendor.trim()) return vendor.trim();
  }
  return row.name.trim();
}

export interface CoverageAssessmentRunResult {
  /** Incumbents whose current assessment was created or updated. */
  assessed: number;
  /** Of those, matched to a posture (verdict != gap). */
  matched: number;
  /** Of those, gaps (no posture named the provider). */
  gaps: number;
  /** Incumbents left untouched (already current, or human-confirmed). */
  unchanged: number;
}

/**
 * Stage 1 — assess every incumbent DigitalProduct against the posture matrix.
 * Matches the incumbent's provider to AbsorptionPosture.providerName; the
 * posture supplies the default verdict + covering capability + confidence.
 * No match → verdict=gap. Idempotent: an unchanged posture_matrix assessment is
 * skipped, and a human-confirmed one is never clobbered.
 */
export async function assessIncumbentsViaPostureMatrix(
  db: PrismaClient,
): Promise<CoverageAssessmentRunResult> {
  const result: CoverageAssessmentRunResult = { assessed: 0, matched: 0, gaps: 0, unchanged: 0 };

  const incumbents = await db.digitalProduct.findMany({
    where: { coverageStatus: "incumbent" },
    select: { productId: true, name: true, observationConfig: true },
  });

  for (const incumbent of incumbents) {
    const provider = providerOfIncumbent(incumbent);
    const resolution = await resolveAbsorptionPosture(db, postureIdentityFromObservation({
      providerName: provider,
      observationConfig: incumbent.observationConfig,
    }));
    const posture = resolution.status === "matched" ? resolution.posture : null;

    const verdict: CoverageVerdict = posture ? (posture.verdict as CoverageVerdict) : "gap";
    const assessmentId = assessmentIdFor(incumbent.productId);
    const resolutionEvidence = resolution.status === "matched" ? {} : resolution.evidence;
    const evidence = posture
      ? {
          via: "posture_matrix",
          provider,
          matchedPosture: `${posture.providerName}/${posture.integrationCategory}`,
        }
      : {
          via: "posture_matrix",
          provider,
          note: resolution.status === "ambiguous"
            ? "multiple postures matched this provider — explicit identity/category required"
            : "no posture named this provider — gap",
          resolution: resolution.status,
          ...resolutionEvidence,
        };

    const existing = await db.incumbentCoverageAssessment.findUnique({
      where: { assessmentId },
      select: { verdict: true, assessedVia: true, status: true },
    });

    // Never clobber a human-confirmed verdict (spec R3 / §7).
    if (existing && existing.status === "confirmed") {
      result.unchanged += 1;
      continue;
    }
    // Idempotent: unchanged posture_matrix default → leave it.
    if (existing && existing.verdict === verdict && existing.assessedVia === "posture_matrix") {
      result.unchanged += 1;
      continue;
    }

    const data = {
      digitalProductId: incumbent.productId,
      verdict,
      coveringCapabilityKey: posture?.coveringPrimitive ?? null,
      confidence: posture?.confidence ?? 0,
      assessedVia: "posture_matrix",
      status: "proposed",
      evidence,
    };

    if (existing) {
      await db.incumbentCoverageAssessment.update({ where: { assessmentId }, data });
    } else {
      await db.incumbentCoverageAssessment.create({ data: { assessmentId, ...data } });
    }

    result.assessed += 1;
    if (verdict === "gap") result.gaps += 1;
    else result.matched += 1;
  }

  return result;
}

/**
 * Stage 4 — a human / authorized coworker confirms (or overrides) a verdict.
 * The ONLY path to status=confirmed (spec §7). Optionally sets a corrected
 * verdict.
 */
export async function confirmCoverageAssessment(
  db: PrismaClient,
  assessmentId: string,
  verdict?: CoverageVerdict,
): Promise<void> {
  await db.incumbentCoverageAssessment.update({
    where: { assessmentId },
    data: {
      assessedVia: "human_confirmed",
      status: "confirmed",
      ...(verdict ? { verdict } : {}),
    },
  });
}

export interface CoverageAssessmentView {
  assessmentId: string;
  digitalProductId: string;
  verdict: string;
  assessedVia: string;
  status: string;
  confidence: number;
  coveringCapabilityKey: string | null;
}

/** The current (non-superseded) coverage assessments — the typed read D6 renders. */
export async function listCoverageAssessments(
  db: PrismaClient,
): Promise<CoverageAssessmentView[]> {
  return db.incumbentCoverageAssessment.findMany({
    where: { status: { not: "superseded" } },
    orderBy: [{ verdict: "asc" }, { digitalProductId: "asc" }],
    select: {
      assessmentId: true,
      digitalProductId: true,
      verdict: true,
      assessedVia: true,
      status: true,
      confidence: true,
      coveringCapabilityKey: true,
    },
  });
}

// ─── Stage 2 — rule (spec §5.4) ──────────────────────────────────────────────
//
// The deterministic covering-capability resolution: an incumbent's archetype
// (carried by its matched posture's archetypeIds) → the archetype's category →
// the business-capability the category corpus already maps
// (CATEGORY_BUSINESS_CAPABILITY_PERSPECTIVES, keyed by archetype category). This
// traverses EXISTING substrate (ALL_ARCHETYPES + the corpus), no authored
// crosswalk. It populates coveringBusinessCapabilityId that stage 1 leaves
// unresolved; it does NOT change the verdict or its posture_matrix provenance
// (the verdict is still the authored posture default awaiting confirmation).
//
// Scope honesty: a rule stage that produces a VERDICT for gap incumbents (ones
// the posture matrix never named) needs a crosswalk between the incumbent
// identity vocabulary (CatalogIdentity CPE category) and the archetype/capability
// vocabulary — that crosswalk does not exist and is a separate authoring effort.
// This stage resolves what the existing substrate deterministically supports.

/** The covering business capability for an archetype category, via the corpus
 *  (CATEGORY_BUSINESS_CAPABILITY_PERSPECTIVES). Pure — no client, no cross-package
 *  import. Returns null when the category is not one the corpus covers. */
export function coveringBusinessCapabilityForCategory(
  category: string | null | undefined,
): { businessCapabilityId: string; category: string } | null {
  if (!category) return null;
  const perspective = CATEGORY_BUSINESS_CAPABILITY_PERSPECTIVES[category];
  if (!perspective) return null;
  // The covering capability is the perspective's root (level-1) business
  // capability; fall back to the perspective id if the tree shape ever changes.
  const root = perspective.capabilities.find((c) => c.level === 1);
  return { businessCapabilityId: root?.key ?? perspective.perspectiveId, category };
}

export interface RuleStageResult {
  /** Assessments whose coveringBusinessCapabilityId was resolved/updated. */
  enriched: number;
  /** Left untouched (no posture, no covered archetype, already set, or confirmed). */
  skipped: number;
}

/**
 * Stage 2 — resolve the covering business capability for each incumbent via the
 * category corpus (deterministic, existing substrate). Enriches the current
 * assessment produced by stage 1; never clobbers a human-confirmed row; idempotent.
 * Correct over an empty set — 0 incumbents / no covered archetype → 0 enriched.
 */
export async function assessIncumbentsViaRule(db: PrismaClient): Promise<RuleStageResult> {
  const result: RuleStageResult = { enriched: 0, skipped: 0 };

  const incumbents = await db.digitalProduct.findMany({
    where: { coverageStatus: "incumbent" },
    select: { productId: true, name: true, observationConfig: true },
  });

  for (const incumbent of incumbents) {
    const resolution = await resolveAbsorptionPosture(db, postureIdentityFromObservation({
      providerName: providerOfIncumbent(incumbent),
      observationConfig: incumbent.observationConfig,
    }));
    const posture = resolution.status === "matched" ? resolution.posture : null;
    if (!posture || posture.archetypeIds.length === 0) {
      result.skipped += 1;
      continue;
    }
    // archetypeId → category via StorefrontArchetype (the DB the pipeline already
    // holds), then category → covering business capability via the corpus.
    const archetype = await db.storefrontArchetype.findFirst({
      where: { archetypeId: { in: posture.archetypeIds } },
      select: { category: true },
    });
    const covering = coveringBusinessCapabilityForCategory(archetype?.category);
    if (!covering) {
      result.skipped += 1;
      continue;
    }

    const assessmentId = assessmentIdFor(incumbent.productId);
    const existing = await db.incumbentCoverageAssessment.findUnique({
      where: { assessmentId },
      select: { coveringBusinessCapabilityId: true, status: true },
    });
    // Stage 1 must have created the row; never touch a confirmed one; idempotent.
    if (
      !existing ||
      existing.status === "confirmed" ||
      existing.coveringBusinessCapabilityId === covering.businessCapabilityId
    ) {
      result.skipped += 1;
      continue;
    }

    await db.incumbentCoverageAssessment.update({
      where: { assessmentId },
      data: { coveringBusinessCapabilityId: covering.businessCapabilityId },
    });
    result.enriched += 1;
  }

  return result;
}

export interface CoveragePipelineResult {
  postureMatrix: CoverageAssessmentRunResult;
  rule: RuleStageResult;
}

/**
 * Run the deterministic stages of the coverage pipeline in the spec's order —
 * cheapest and most trustworthy first: stage 1 (posture_matrix) then stage 2
 * (rule). Stage 3 (AI) is a separate apps/web concern (it needs the inference
 * chain) and runs after these; stage 4 (human) is on-demand via
 * confirmCoverageAssessment.
 */
export async function runCoverageAssessmentPipeline(
  db: PrismaClient,
): Promise<CoveragePipelineResult> {
  const postureMatrix = await assessIncumbentsViaPostureMatrix(db);
  const rule = await assessIncumbentsViaRule(db);
  return { postureMatrix, rule };
}
