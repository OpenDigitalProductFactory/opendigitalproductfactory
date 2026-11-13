// BI-22601A38. The IO half of resolving an architecture advisory from what
// happened downstream (see architecture-advisory-outcome.ts for the rule and
// WWMD decision DI-ABF1EFCB4BC1 for why).
//
// Runs inside the six-hourly decision-trust recompute, after the ledger
// backfill and before TrustState is recomputed. It writes the shadow ledger
// row only — never DecisionInteraction.humanOutcome, which is where a person's
// answer lives — and only onto a row that is not yet reconciled, so a person's
// answer that reached the ledger first is never overwritten.

import { readRecordedCoworkerProposal } from "@/lib/decision/coworker-proposal";
import { decisionShadowLedgerId } from "@/lib/decision/decision-shadow-ledger-mapping";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import {
  deriveArchitectureAdvisoryOutcomes,
  readReviewedArtifact,
  type AdvisoryForOutcome,
} from "./architecture-advisory-outcome";

type Row = Record<string, unknown>;

export type AdvisoryOutcomeSweepDb = {
  decisionInteraction: { findMany(args: unknown): Promise<Row[]> };
  featureBuild: { findMany(args: unknown): Promise<Row[]> };
  decisionShadowLedger: {
    findMany(args: unknown): Promise<Row[]>;
    updateMany(args: unknown): Promise<unknown>;
  };
};

export type AdvisoryOutcomeSweepResult = {
  /** Advisories that name what they reviewed and that no person has answered. */
  examined: number;
  /** Of those, how many the record resolves. */
  resolved: number;
  written: number;
  failed: number;
  firstError: string | null;
};

/** The routes that record an architecture advisory. */
const ADVISORY_ROUTES = ["reviewDesignDoc", "reviewPlanDoc"];

export async function resolveArchitectureAdvisoryOutcomes(
  db: AdvisoryOutcomeSweepDb,
  options: { now?: Date } = {},
): Promise<AdvisoryOutcomeSweepResult> {
  const now = options.now ?? new Date();
  const result: AdvisoryOutcomeSweepResult = { examined: 0, resolved: 0, written: 0, failed: 0, firstError: null };

  const rows = await db.decisionInteraction.findMany({
    where: {
      domainClass: "architecture-tradeoff",
      routeContext: { in: ADVISORY_ROUTES },
      buildId: { not: null },
    },
    select: {
      interactionId: true,
      buildId: true,
      gateKey: true,
      options: true,
      scoredOptions: true,
      outcomePayload: true,
      humanOutcome: true,
      createdAt: true,
    },
  });

  const advisories: AdvisoryForOutcome[] = [];
  for (const row of rows) {
    const reviewed = readReviewedArtifact(row.outcomePayload);
    if (!reviewed || reviewed.buildId !== row.buildId) continue;
    // A person's answer is the resolution; the ledger backfill carries it.
    if (row.humanOutcome !== null && row.humanOutcome !== undefined) continue;
    advisories.push({
      ...reviewed,
      interactionId: String(row.interactionId),
      proposedOptionId: readRecordedCoworkerProposal({
        gateKey: row.gateKey,
        options: row.options,
        scoredOptions: row.scoredOptions,
        outcomePayload: row.outcomePayload,
      }),
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
    });
  }
  result.examined = advisories.length;
  if (advisories.length === 0) return result;

  const builds = await db.featureBuild.findMany({
    where: { buildId: { in: [...new Set(advisories.map((a) => a.buildId))] } },
    select: { buildId: true, phase: true, designDoc: true, buildPlan: true },
  });
  const outcomes = deriveArchitectureAdvisoryOutcomes(
    advisories,
    builds.map((b) => ({ buildId: String(b.buildId), phase: String(b.phase), designDoc: b.designDoc, buildPlan: b.buildPlan })),
    now,
  );
  result.resolved = outcomes.size;
  if (outcomes.size === 0) return result;

  const ledgerRows = await db.decisionShadowLedger.findMany({
    where: { ledgerId: { in: [...outcomes.keys()].map(decisionShadowLedgerId) }, reconciledAt: null },
    select: { ledgerId: true, metadata: true },
  });
  const metadataByLedgerId = new Map(ledgerRows.map((r) => [String(r.ledgerId), (r.metadata ?? {}) as Row]));

  for (const [interactionId, outcome] of outcomes) {
    const ledgerId = decisionShadowLedgerId(interactionId);
    const metadata = metadataByLedgerId.get(ledgerId);
    if (!metadata) continue;
    const disposition = outcome.agreement ? "followed" : "overridden";
    try {
      await db.decisionShadowLedger.updateMany({
        where: { ledgerId, reconciledAt: null },
        data: {
          actualDecision: { chosenOptionId: outcome.chosenOptionId, disposition },
          outcome: { disposition, resolvedBy: "outcome", resolvedAt: outcome.resolvedAt, signal: outcome.signal },
          agreement: outcome.agreement,
          reconciledAt: new Date(outcome.resolvedAt),
          metadata: {
            ...metadata,
            resolvedBy: "outcome",
            outcomeEvidence: { signal: outcome.signal, ...outcome.evidence },
          },
        },
      });
      result.written += 1;
    } catch (error) {
      result.failed += 1;
      result.firstError ??= getErrorMessage(error);
    }
  }
  return result;
}
