// The one read behind the weekly decision-engine review (BI-19CEC4B4).
//
// Deliberately the only place the review touches the database: the measures
// (measures.ts) are pure over these rows, so every finding is reproducible from
// a fixture and the run carries no model judgement at all.

import type { ReviewLedgerRow } from "./measures";

/** Narrow client surface so tests need no Prisma. */
export type ReviewWindowClient = {
  decisionInteraction: {
    findMany(args: unknown): Promise<unknown>;
  };
  decisionPerspectiveProfile: {
    findMany(args: unknown): Promise<unknown>;
  };
  perspectiveMaterial: {
    groupBy(args: unknown): Promise<unknown>;
  };
};

export type ReviewWindow = {
  rows: ReviewLedgerRow[];
  materialCountByProfile: Record<string, number>;
  since: Date;
  until: Date;
};

export const REVIEW_WINDOW_DAYS = 7;

/**
 * Bounds the read on a ledger that grows without limit. A week of this
 * install's traffic is ~900 rows; the cap exists so a burst cannot turn the
 * weekly review into an unbounded scan.
 */
export const REVIEW_WINDOW_ROW_CAP = 20_000;

export async function loadReviewWindow(
  db: ReviewWindowClient,
  options: { now?: Date; days?: number } = {},
): Promise<ReviewWindow> {
  const until = options.now ?? new Date();
  const days = options.days ?? REVIEW_WINDOW_DAYS;
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  const [interactions, profiles, materialCounts] = await Promise.all([
    db.decisionInteraction.findMany({
      where: { createdAt: { gte: since, lte: until } },
      orderBy: { createdAt: "desc" },
      take: REVIEW_WINDOW_ROW_CAP,
      select: {
        interactionId: true,
        profileId: true,
        gateKey: true,
        routeContext: true,
        domainClass: true,
        outcomeType: true,
        riskTier: true,
        question: true,
        gateFallbackUsed: true,
        outcomePayload: true,
        recommendedOptionId: true,
        chosenOptionId: true,
        sensitivityUnstable: true,
        sensitivity: true,
        createdAt: true,
      },
    }),
    db.decisionPerspectiveProfile.findMany({ select: { profileId: true, kind: true } }),
    // Only material the gate can actually read counts as coverage; a draft or
    // unpromoted row would make a starved profile look fed.
    db.perspectiveMaterial.groupBy({
      by: ["profileId"],
      where: { reviewStatus: "approved", promotionState: "promoted" },
      _count: { _all: true },
    }),
  ]);

  const kindByProfile = new Map(
    (profiles as Array<{ profileId: string; kind: string }>).map((p) => [p.profileId, p.kind]),
  );

  const rows: ReviewLedgerRow[] = (interactions as Array<Record<string, unknown>>).map((r) => ({
    interactionId: String(r.interactionId ?? ""),
    profileId: String(r.profileId ?? ""),
    profileKind: normaliseKind(kindByProfile.get(String(r.profileId ?? ""))),
    gateKey: (r.gateKey as string | null) ?? null,
    routeContext: (r.routeContext as string | null) ?? null,
    domainClass: String(r.domainClass ?? ""),
    outcomeType: String(r.outcomeType ?? ""),
    riskTier: String(r.riskTier ?? ""),
    question: String(r.question ?? ""),
    gateFallbackUsed: r.gateFallbackUsed === true,
    outcomePayload: r.outcomePayload ?? null,
    recommendedOptionId: (r.recommendedOptionId as string | null) ?? null,
    chosenOptionId: (r.chosenOptionId as string | null) ?? null,
    sensitivityUnstable: (r.sensitivityUnstable as boolean | null) ?? null,
    sensitivity: r.sensitivity ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt)),
  }));

  const materialCountByProfile: Record<string, number> = {};
  for (const row of materialCounts as Array<{ profileId: string; _count: { _all: number } }>) {
    materialCountByProfile[row.profileId] = row._count._all;
  }

  return { rows, materialCountByProfile, since, until };
}

/** A profile kind the measures understand; anything else scores as platform. */
function normaliseKind(kind: string | undefined): ReviewLedgerRow["profileKind"] {
  return kind === "organization" || kind === "profession" ? kind : "platform";
}
