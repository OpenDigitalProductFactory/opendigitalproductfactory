// BI-D88DFEEA Phase 3 — persist WeightAdjustmentProposal rows and rule on
// them. Spec §2.4: "a proposal, never a silent mutation... enters the same
// confirmation ladder... requires the same human ruling to reach `ruled`."
//
// stance-promotion.ts's promoteStanceMaterial() is the ladder authored STANCE
// MATERIAL is promoted through — it upserts a PerspectiveMaterial row keyed
// on a WikiPage/slug/domainClass. A weight-adjustment proposal is not
// material (it has no WikiPage, no slug, no domain-class bundle to publish);
// it is evidence about an AXIS WEIGHT. So this module does not call
// promoteStanceMaterial — it reuses only the LADDER'S VOCABULARY
// (`ruledTierForProposal()` in weight-inference.ts already returns "ruled",
// the same tier name authored material reaches) via this model's own
// `status` column. `stance-promotion.ts` also has no reject primitive
// (un-ruled stance material simply never gets promoted); a proposal needs an
// explicit terminal "rejected" state so it stops resurfacing on the review
// queue, which is why `status` carries it directly rather than borrowing a
// ladder that has nowhere to put it.

import type { WeightAdjustmentProposal } from "../decision-perspective/weight-inference";

export type WeightAdjustmentProposalStatus = "proposed" | "ruled" | "rejected";

type ProposalClient = {
  weightAdjustmentProposal: {
    findFirst(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

function proposalId(p: Pick<WeightAdjustmentProposal, "profileId" | "domainClass" | "axis">): string {
  return `wap:${p.profileId}:${p.domainClass}:${p.axis}`;
}

/**
 * Persist a batch of inferred proposals. Idempotent per (profileId,
 * domainClass, axis): a still-open ("proposed") row is refreshed with the
 * latest consistency/meanSeparation/sampleSize rather than duplicated — this
 * is the "recompute on drift, not a fixed schedule" behavior §4.2 point 3
 * asks for. A proposal already `ruled` or `rejected` is left untouched: a
 * human's ruling outranks a fresh inference run, exactly like
 * stance-promotion's never-downgrade rule.
 */
export async function persistWeightAdjustmentProposals(
  db: ProposalClient,
  proposals: readonly WeightAdjustmentProposal[],
): Promise<{ proposalIds: string[]; skippedAlreadyRuled: string[] }> {
  const ids: string[] = [];
  const skipped: string[] = [];

  for (const p of proposals) {
    const id = proposalId(p);
    const existing = (await db.weightAdjustmentProposal.findFirst({
      where: { proposalId: id },
      select: { status: true },
    })) as { status: WeightAdjustmentProposalStatus } | null;

    if (existing && existing.status !== "proposed") {
      skipped.push(id);
      continue;
    }

    await db.weightAdjustmentProposal.upsert({
      where: { proposalId: id },
      update: {
        consistency: p.consistency,
        meanSeparation: p.meanSeparation,
        sampleSize: p.sampleSize,
      },
      create: {
        proposalId: id,
        domainClass: p.domainClass,
        profileId: p.profileId,
        axis: p.axis,
        direction: p.direction,
        consistency: p.consistency,
        meanSeparation: p.meanSeparation,
        sampleSize: p.sampleSize,
        entersAtConfidenceWeight: p.entersAtConfidenceWeight,
        status: "proposed",
      },
    });
    ids.push(id);
  }

  return { proposalIds: ids, skippedAlreadyRuled: skipped };
}

export type RuleWeightProposalResult =
  | { ok: true; status: "ruled" | "rejected" }
  | { ok: false; error: "not-found" | "already-ruled" };

/**
 * Rule on a proposal: "accept" reaches `ruled` (the same tier name authored
 * stance material reaches via stance-promotion.ts, per
 * ruledTierForProposal()); "reject" reaches the terminal `rejected` state
 * this model adds since the ladder it mirrors has no reject primitive.
 * Never overwrites an existing ruling — first ruling wins.
 */
export async function ruleWeightAdjustmentProposal(
  db: ProposalClient,
  input: {
    proposalId: string;
    ruling: "accept" | "reject";
    ruledByUserId: string;
    rejectionReason?: string;
  },
): Promise<RuleWeightProposalResult> {
  const existing = (await db.weightAdjustmentProposal.findFirst({
    where: { proposalId: input.proposalId },
    select: { status: true },
  })) as { status: WeightAdjustmentProposalStatus } | null;

  if (!existing) return { ok: false, error: "not-found" };
  if (existing.status !== "proposed") return { ok: false, error: "already-ruled" };

  const status: WeightAdjustmentProposalStatus = input.ruling === "accept" ? "ruled" : "rejected";
  await db.weightAdjustmentProposal.update({
    where: { proposalId: input.proposalId },
    data: {
      status,
      ruledAt: new Date(),
      ruledByUserId: input.ruledByUserId,
      rejectionReason: input.ruling === "reject" ? (input.rejectionReason ?? null) : null,
    },
  });
  return { ok: true, status };
}

/** Open proposals for the review queue, newest first. */
export async function listOpenWeightAdjustmentProposals(
  db: ProposalClient,
): Promise<
  Array<{
    proposalId: string;
    domainClass: string;
    axis: string;
    direction: string;
    consistency: number;
    meanSeparation: number;
    sampleSize: number;
  }>
> {
  return (await db.weightAdjustmentProposal.findMany({
    where: { status: "proposed" },
    orderBy: { createdAt: "desc" },
    select: {
      proposalId: true,
      domainClass: true,
      axis: true,
      direction: true,
      consistency: true,
      meanSeparation: true,
      sampleSize: true,
    },
  })) as Array<{
    proposalId: string;
    domainClass: string;
    axis: string;
    direction: string;
    consistency: number;
    meanSeparation: number;
    sampleSize: number;
  }>;
}
