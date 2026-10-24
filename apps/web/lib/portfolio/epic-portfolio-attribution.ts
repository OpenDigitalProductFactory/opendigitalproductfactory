// Epic → portfolio attribution: load a proposal for every epic, and confirm
// proposals through one governed write that records who confirmed, why, and how
// confident the proposal was (BI-A73A7DA3, design §5.2). The platform never
// writes an attribution without a confirming person.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { attributeBacklogPortfolio, type BacklogPortfolioClient } from "@dpf/db/backlog-portfolio";

import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

import {
  buildPortfolioVocabulary,
  proposeEpicPortfolio,
  type EpicPortfolioConfidence,
  type EpicPortfolioProposal,
} from "./epic-portfolio-proposal";

type ReadDb = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

export type EpicPortfolioProposalRow = EpicPortfolioProposal & {
  title: string;
  status: string;
  /** Portfolios the epic is attributed to today, with the confirmation if one was recorded. */
  current: Array<{ portfolioId: string; confirmedAt: Date | null; proposalConfidence: EpicPortfolioConfidence | null }>;
};

type EpicScanRow = {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  itemPortfolioIds: Array<string | null> | null;
  current: Array<{ portfolioId: string; confirmedAt: string | null; proposalConfidence: EpicPortfolioConfidence | null }> | null;
};

/**
 * A proposal for every epic. Item evidence uses only the links an item carries
 * itself (product, taxonomy node, coworker need); the cached BacklogItem
 * portfolioId is left out because it may itself be derived from the epic.
 */
export async function loadEpicPortfolioProposals(db: ReadDb): Promise<EpicPortfolioProposalRow[]> {
  const vocabularyRows = await db.$queryRaw<Array<{ portfolioId: string; text: string | null }>>`
    SELECT p."id" AS "portfolioId", concat_ws(' ', p."name", p."description") AS "text" FROM "Portfolio" p
    UNION ALL
    SELECT t."portfolioId", concat_ws(' ', t."name", t."description") FROM "TaxonomyNode" t WHERE t."portfolioId" IS NOT NULL
  `;
  const vocabulary = buildPortfolioVocabulary(vocabularyRows);
  const epics = await db.$queryRaw<EpicScanRow[]>`
    SELECT
      e."id", e."epicId", e."title", e."description", e."status"::text AS "status",
      (SELECT array_agg(COALESCE(dp."portfolioId", tn."portfolioId",
          (SELECT a."portfolioId" FROM "CoworkerCapabilityNeed" n JOIN "Agent" a ON a."agentId" = n."agentId"
            WHERE n."linkedBacklogItemId" = b."itemId" AND a."portfolioId" IS NOT NULL ORDER BY n."needId" LIMIT 1)))
         FROM "BacklogItem" b
         LEFT JOIN "DigitalProduct" dp ON dp."id" = b."digitalProductId"
         LEFT JOIN "TaxonomyNode" tn ON tn."id" = b."taxonomyNodeId"
        WHERE b."epicId" = e."id") AS "itemPortfolioIds",
      (SELECT json_agg(json_build_object('portfolioId', ep."portfolioId", 'confirmedAt', ep."confirmedAt",
          'proposalConfidence', ep."proposalConfidence") ORDER BY ep."portfolioId")
         FROM "EpicPortfolio" ep WHERE ep."epicId" = e."id") AS "current"
    FROM "Epic" e
    ORDER BY e."epicId"
  `;
  return epics.map((epic) => ({
    ...proposeEpicPortfolio(
      { epicId: epic.epicId, title: epic.title, description: epic.description, itemPortfolioIds: epic.itemPortfolioIds ?? [] },
      vocabulary,
    ),
    title: epic.title,
    status: epic.status,
    current: (epic.current ?? []).map((c) => ({ ...c, confirmedAt: c.confirmedAt ? new Date(c.confirmedAt) : null })),
  }));
}

export type EpicPortfolioConfirmation = { epicId: string; portfolioId: string };

export type ConfirmEpicPortfoliosInput = {
  confirmations: EpicPortfolioConfirmation[];
  reason: string;
  actor: { userId: string | null; agentId?: string | null };
  /** "high" confirms only proposals the server still rates high, for exactly the proposed portfolio. */
  batch?: "high";
};

export type ConfirmedEpicPortfolio = {
  epicId: string;
  portfolioId: string;
  proposalConfidence: EpicPortfolioConfidence | null;
  itemsReattributed: number;
};

export type ConfirmEpicPortfoliosRefusal =
  | "reason_required" | "actor_required" | "nothing_to_confirm" | "unknown_epic" | "unknown_portfolio" | "not_high_confidence";

/** The shared action result; a refusal carries its code as `error` and a readable `message`. */
export type ConfirmEpicPortfoliosResult =
  | ActionSuccess<{ confirmed: ConfirmedEpicPortfolio[] }>
  | (ActionFailure & { error: ConfirmEpicPortfoliosRefusal; message: string });

function refuse(error: ConfirmEpicPortfoliosRefusal, message: string): ConfirmEpicPortfoliosResult {
  return { ok: false, error, message };
}

type WriteDb = ReadDb & {
  epic: { findMany: (args: unknown) => Promise<Array<{ id: string; epicId: string; items: Array<{ id: string }> }>> };
  portfolio: { findMany: (args: unknown) => Promise<Array<{ id: string }>> };
  agent: { findUnique: (args: unknown) => Promise<{ agentId: string } | null> };
  epicPortfolio: {
    deleteMany: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: WriteDb & BacklogPortfolioClient) => Promise<T>) => Promise<T>;
};

export async function confirmEpicPortfolios(db: WriteDb, input: ConfirmEpicPortfoliosInput): Promise<ConfirmEpicPortfoliosResult> {
  const reason = input.reason.trim();
  if (!reason) return refuse("reason_required", "Say why this attribution is right; the reason is recorded with it.");
  if (!input.actor.userId) {
    return refuse("actor_required", "An epic's portfolio is confirmed by a person. No confirming person is attached to this request.");
  }
  if (input.confirmations.length === 0) return refuse("nothing_to_confirm", "No epics were named.");

  const epics = await db.epic.findMany({
    where: { epicId: { in: input.confirmations.map((c) => c.epicId) } },
    select: { id: true, epicId: true, items: { select: { id: true } } },
  });
  const byEpicId = new Map(epics.map((epic) => [epic.epicId, epic]));
  const missingEpic = input.confirmations.find((c) => !byEpicId.has(c.epicId));
  if (missingEpic) return refuse("unknown_epic", `Epic ${missingEpic.epicId} does not exist.`);
  const portfolios = new Set((await db.portfolio.findMany({
    where: { id: { in: input.confirmations.map((c) => c.portfolioId) } },
    select: { id: true },
  })).map((p) => p.id));
  const missingPortfolio = input.confirmations.find((c) => !portfolios.has(c.portfolioId));
  if (missingPortfolio) return refuse("unknown_portfolio", `Portfolio ${missingPortfolio.portfolioId} does not exist.`);

  // Re-derive proposals server-side: a client's claim of "high" is never evidence.
  const proposals = new Map((await loadEpicPortfolioProposals(db)).map((p) => [p.epicId, p]));
  if (input.batch === "high") {
    const notHigh = input.confirmations.filter((c) => {
      const proposal = proposals.get(c.epicId);
      return proposal?.confidence !== "high" || proposal.portfolioId !== c.portfolioId;
    });
    if (notHigh.length > 0) {
      return refuse(
        "not_high_confidence",
        `A batch confirms only high-confidence proposals. Confirm these one at a time instead: ${notHigh.map((c) => c.epicId).join(", ")}.`,
      );
    }
  }

  // Record the carrying coworker only when it is a registered agent; an
  // unregistered caller label is not an identity the row can point at.
  const confirmedByAgentId = input.actor.agentId
    ? (await db.agent.findUnique({ where: { agentId: input.actor.agentId }, select: { agentId: true } }))?.agentId ?? null
    : null;
  const confirmedAt = new Date();
  return db.$transaction(async (tx) => {
    const confirmed: ConfirmedEpicPortfolio[] = [];
    for (const confirmation of input.confirmations) {
      const epic = byEpicId.get(confirmation.epicId)!;
      const proposal = proposals.get(confirmation.epicId);
      const proposalConfidence = proposal?.portfolioId === confirmation.portfolioId ? proposal.confidence : null;
      await tx.epicPortfolio.deleteMany({ where: { epicId: epic.id } });
      await tx.epicPortfolio.create({
        data: {
          epicId: epic.id,
          portfolioId: confirmation.portfolioId,
          confirmedById: input.actor.userId,
          confirmedByAgentId,
          confirmationReason: reason,
          confirmedAt,
          proposalConfidence,
        },
      });
      let itemsReattributed = 0;
      for (const item of epic.items) {
        const before = await attributeBacklogPortfolio(item.id, { db: tx });
        if (before !== null) itemsReattributed++;
      }
      confirmed.push({ epicId: confirmation.epicId, portfolioId: confirmation.portfolioId, proposalConfidence, itemsReattributed });
    }
    return ok({ confirmed });
  });
}
