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

/** ReDoS-safe slug (single-pass collapse) for a stable assessmentId. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

/** One current assessment per incumbent — stable, deterministic id. */
export function assessmentIdFor(digitalProductId: string): string {
  return `assess-${slug(digitalProductId)}`;
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
    const posture = await db.absorptionPosture.findFirst({
      where: { providerName: { equals: provider, mode: "insensitive" } },
      select: {
        verdict: true,
        coveringPrimitive: true,
        confidence: true,
        providerName: true,
        integrationCategory: true,
      },
    });

    const verdict: CoverageVerdict = posture ? (posture.verdict as CoverageVerdict) : "gap";
    const assessmentId = assessmentIdFor(incumbent.productId);
    const evidence = posture
      ? {
          via: "posture_matrix",
          provider,
          matchedPosture: `${posture.providerName}/${posture.integrationCategory}`,
        }
      : { via: "posture_matrix", provider, note: "no posture named this provider — gap" };

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
