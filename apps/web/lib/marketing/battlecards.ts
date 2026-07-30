// Marketing execution loop — competitive battlecards (EP-MARKETING-EXEC slice C).
//
// Upgrades the competitive-analysis skill from chat-only advice to a durable,
// reusable artifact. One card per competitor; multiple cards project into a
// competitive matrix. The matrix builder is a PURE function (buildCompetitiveMatrix)
// unit-tested without a database; the DB layer only reads/writes.

import { prisma } from "@dpf/db";
import { getMarketingWorkspaceSnapshot } from "../marketing";
import {
  assertProductIntelligenceScopeExists,
  buildExactProductIntelligenceScopeWhere,
  normalizeProductIntelligenceScope,
} from "@/lib/product-management/product-intelligence-scope";

export type ObjectionHandlingEntry = { objection: string; response: string };

export type BattlecardRow = {
  battlecardId: string;
  digitalProductId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  competitorName: string;
  positioning: string | null;
  theirStrengths: string[];
  theirWeaknesses: string[];
  ourDifferentiators: string[];
  winThemes: string[];
  status: string;
};

export type CompetitiveMatrix = {
  competitors: string[];
  /** Union of every differentiator we claim across all cards, sorted, de-duplicated. */
  differentiators: string[];
  /** competitorName → the differentiators that card lists (subset of `differentiators`). */
  coverage: Record<string, string[]>;
  activeCount: number;
  totalCount: number;
};

function normalizeList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Project battlecards into a competitive matrix: the sorted set of competitors,
 * the de-duplicated union of differentiators we claim, and per-competitor
 * coverage. Only `active` cards contribute to the matrix; archived cards still
 * count in totalCount so the caller can see history. Pure — no DB.
 */
export function buildCompetitiveMatrix(cards: BattlecardRow[]): CompetitiveMatrix {
  const active = cards.filter((c) => c.status === "active");
  const competitors = normalizeList(active.map((c) => c.competitorName)).sort((a, b) =>
    a.localeCompare(b),
  );

  const differentiatorSet = new Set<string>();
  const coverage: Record<string, string[]> = {};
  for (const card of active) {
    const diffs = normalizeList(card.ourDifferentiators);
    coverage[card.competitorName] = diffs;
    for (const d of diffs) differentiatorSet.add(d);
  }
  const differentiators = Array.from(differentiatorSet).sort((a, b) => a.localeCompare(b));

  return {
    competitors,
    differentiators,
    coverage,
    activeCount: active.length,
    totalCount: cards.length,
  };
}

export type CreateBattlecardInput = {
  /** Null/omitted means organization-wide positioning. */
  digitalProductId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  competitorName: string;
  positioning?: string;
  theirStrengths?: string[];
  theirWeaknesses?: string[];
  ourDifferentiators?: string[];
  winThemes?: string[];
  objectionHandling?: ObjectionHandlingEntry[];
  notes?: string;
  createdByAgentId?: string | null;
};

export function battlecardScopeWhere(input: {
  organizationId: string;
  digitalProductId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
}) {
  const hasExplicitScope =
    input.digitalProductId !== undefined ||
    input.productLineId !== undefined ||
    input.businessProductId !== undefined;
  return hasExplicitScope
    ? buildExactProductIntelligenceScopeWhere(input)
    : { organizationId: input.organizationId };
}

/** Create a competitive battlecard in the org's marketing workspace. */
export async function createBattlecard(
  input: CreateBattlecardInput,
): Promise<{ battlecardId: string; message: string } | { error: string; message: string }> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) {
    return { error: "no-workspace", message: "No configured marketing workspace; cannot create a battlecard." };
  }
  const scope = normalizeProductIntelligenceScope({
    organizationId: snapshot.organization.id,
    digitalProductId: input.digitalProductId,
    productLineId: input.productLineId,
    businessProductId: input.businessProductId,
  });
  await assertProductIntelligenceScopeExists(scope, prisma);
  const competitorName = input.competitorName.trim();
  if (!competitorName) {
    return { error: "invalid-input", message: "A battlecard needs a competitor name." };
  }
  const record = await prisma.marketingBattlecard.create({
    data: {
      ...buildExactProductIntelligenceScopeWhere(scope),
      competitorName,
      positioning: input.positioning?.trim() || null,
      theirStrengths: normalizeList(input.theirStrengths ?? []),
      theirWeaknesses: normalizeList(input.theirWeaknesses ?? []),
      ourDifferentiators: normalizeList(input.ourDifferentiators ?? []),
      winThemes: normalizeList(input.winThemes ?? []),
      objectionHandling: input.objectionHandling ?? undefined,
      notes: input.notes?.trim() || null,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { battlecardId: true, competitorName: true },
  });
  return {
    battlecardId: record.battlecardId,
    message: `Created battlecard vs "${record.competitorName}". Add more competitors and read get_battlecards for the competitive matrix.`,
  };
}

/** List the org's battlecards plus the projected competitive matrix. */
export async function getBattlecards(input: {
  /** Undefined returns all; null returns organization-wide cards only. */
  digitalProductId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
} = {}): Promise<
  | { message: string; data: { battlecards: BattlecardRow[]; matrix: CompetitiveMatrix } }
  | { error: string; message: string }
> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) {
    return { error: "no-workspace", message: "No configured marketing workspace; there are no battlecards yet." };
  }
  const rows = await prisma.marketingBattlecard.findMany({
    where: battlecardScopeWhere({
      organizationId: snapshot.organization.id,
      digitalProductId: input.digitalProductId,
      productLineId: input.productLineId,
      businessProductId: input.businessProductId,
    }),
    orderBy: { createdAt: "asc" },
    select: {
      battlecardId: true,
      digitalProductId: true,
      productLineId: true,
      businessProductId: true,
      competitorName: true,
      positioning: true,
      theirStrengths: true,
      theirWeaknesses: true,
      ourDifferentiators: true,
      winThemes: true,
      status: true,
    },
  });
  const matrix = buildCompetitiveMatrix(rows);
  const message =
    rows.length === 0
      ? "No battlecards yet — create one per key competitor to build the competitive matrix."
      : `${rows.length} battlecard(s), ${matrix.competitors.length} active competitor(s), ${matrix.differentiators.length} distinct differentiator(s) claimed.`;
  return { message, data: { battlecards: rows, matrix } };
}
