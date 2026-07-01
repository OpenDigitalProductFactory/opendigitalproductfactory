// Marketing execution loop — A/B copy variants (EP-MARKETING-EXEC parity slice B).
//
// Lets the Marketing Strategist produce multiple copy treatments for one asset
// task, record measured results per variant, and read a ranked summary with a
// winner recommendation. Winner selection is a PURE function of the variant
// rows (summarizeVariants) — the DB layer only reads/writes; the decision logic
// is unit-tested without a database. Metrics are stored inline on the variant
// so ranking needs no cross-table join.

import { prisma } from "@dpf/db";

/** Below this many impressions a variant is too thin to crown a winner on. */
export const MIN_IMPRESSIONS_FOR_DECISION = 100;

export type VariantMetrics = {
  variantId: string;
  label: string;
  impressions: number;
  clicks: number;
  conversions: number;
  status: string;
};

export type RankedVariant = VariantMetrics & {
  /** clicks / impressions */
  ctr: number;
  /** conversions / clicks */
  conversionRate: number;
  /** conversions / impressions — the end-to-end efficiency we rank on */
  efficiency: number;
};

export type VariantSummary = {
  variants: RankedVariant[];
  /** Highest-efficiency variant that also clears the min-impressions guard, else null. */
  winner: RankedVariant | null;
  /** True when a winner exists AND it is not tied with the runner-up. */
  decisive: boolean;
  rationale: string;
};

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Rank variants by end-to-end efficiency (conversions per impression), tie-broken
 * by CTR then impression volume. A winner is only recommended when the leader has
 * at least MIN_IMPRESSIONS_FOR_DECISION impressions, so we never crown noise.
 * `decisive` additionally requires the leader to strictly beat the runner-up.
 */
export function summarizeVariants(variants: VariantMetrics[]): VariantSummary {
  const ranked: RankedVariant[] = variants
    .map((v) => ({
      ...v,
      ctr: ratio(v.clicks, v.impressions),
      conversionRate: ratio(v.conversions, v.clicks),
      efficiency: ratio(v.conversions, v.impressions),
    }))
    .sort(
      (a, b) =>
        b.efficiency - a.efficiency ||
        b.ctr - a.ctr ||
        b.impressions - a.impressions ||
        a.label.localeCompare(b.label),
    );

  if (ranked.length === 0) {
    return { variants: [], winner: null, decisive: false, rationale: "No variants yet." };
  }

  const leader = ranked[0]!;
  const runnerUp = ranked[1] ?? null;
  const leaderHasData = leader.impressions >= MIN_IMPRESSIONS_FOR_DECISION;

  if (!leaderHasData) {
    return {
      variants: ranked,
      winner: null,
      decisive: false,
      rationale: `Not enough data to call a winner — the leading variant "${leader.label}" has ${leader.impressions} impression(s), below the ${MIN_IMPRESSIONS_FOR_DECISION} needed. Keep both running.`,
    };
  }

  const tiedWithRunnerUp =
    runnerUp !== null && runnerUp.efficiency === leader.efficiency && runnerUp.ctr === leader.ctr;
  const decisive = !tiedWithRunnerUp;

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const rationale = decisive
    ? `Variant "${leader.label}" leads on conversions-per-impression (${pct(leader.efficiency)} vs ${runnerUp ? pct(runnerUp.efficiency) : "n/a"}) with ${leader.impressions} impressions — recommend declaring it the winner.`
    : `Variants "${leader.label}" and "${runnerUp?.label}" are tied on the primary metric — run longer or add a decisive creative change before calling it.`;

  return { variants: ranked, winner: decisive ? leader : null, decisive, rationale };
}

export type CreateVariantInput = {
  taskId: string;
  label: string;
  body: string;
  headline?: string;
  hypothesis?: string;
  createdByAgentId?: string | null;
};

/** Create an A/B variant under an asset task; org is inherited from the task. */
export async function createAssetVariant(
  input: CreateVariantInput,
): Promise<{ variantId: string; message: string } | { error: string; message: string }> {
  const task = await prisma.marketingAssetTask.findUnique({
    where: { taskId: input.taskId },
    select: { taskId: true, organizationId: true, title: true },
  });
  if (!task) {
    return { error: "no-task", message: `No asset task ${input.taskId} to attach a variant to.` };
  }
  const label = input.label.trim();
  const body = input.body.trim();
  if (!label || !body) {
    return { error: "invalid-input", message: "A variant needs a non-empty label and body." };
  }
  const record = await prisma.marketingAssetVariant.create({
    data: {
      organizationId: task.organizationId,
      taskId: task.taskId,
      label,
      body,
      headline: input.headline?.trim() || null,
      hypothesis: input.hypothesis?.trim() || null,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { variantId: true, label: true },
  });
  return {
    variantId: record.variantId,
    message: `Created variant "${record.label}" for "${task.title}". Record its results with record_variant_result as data comes in.`,
  };
}

export type RecordVariantResultInput = {
  variantId: string;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  status?: string;
};

/**
 * Update a variant's measured metrics and/or status. Metrics are set absolutely
 * (not incremented) so a channel refresh can overwrite with the latest totals.
 */
export async function recordVariantResult(
  input: RecordVariantResultInput,
): Promise<{ variantId: string; message: string } | { error: string; message: string }> {
  const existing = await prisma.marketingAssetVariant.findUnique({
    where: { variantId: input.variantId },
    select: { variantId: true, label: true },
  });
  if (!existing) {
    return { error: "no-variant", message: `No variant ${input.variantId}.` };
  }
  const hasImpressions = typeof input.impressions === "number";
  const hasClicks = typeof input.clicks === "number";
  const hasConversions = typeof input.conversions === "number";
  const hasStatus = typeof input.status === "string" && input.status.trim().length > 0;
  if (!hasImpressions && !hasClicks && !hasConversions && !hasStatus) {
    return { error: "no-op", message: "Nothing to update — pass impressions, clicks, conversions, or status." };
  }
  // Inline conditional spreads (not a Record<string, unknown> intermediate) so
  // Prisma's typed update input validates each field — see updateMarketingCampaign.
  await prisma.marketingAssetVariant.update({
    where: { variantId: input.variantId },
    data: {
      ...(hasImpressions ? { impressions: Math.max(0, Math.round(input.impressions!)) } : {}),
      ...(hasClicks ? { clicks: Math.max(0, Math.round(input.clicks!)) } : {}),
      ...(hasConversions ? { conversions: Math.max(0, Math.round(input.conversions!)) } : {}),
      ...(hasStatus ? { status: input.status!.trim() } : {}),
    },
  });
  return { variantId: input.variantId, message: `Updated variant "${existing.label}".` };
}

/** Read a task's variants as a ranked summary with a winner recommendation. */
export async function getAssetVariants(
  taskId: string,
): Promise<{ message: string; data: VariantSummary } | { error: string; message: string }> {
  const task = await prisma.marketingAssetTask.findUnique({
    where: { taskId },
    select: { taskId: true, title: true },
  });
  if (!task) {
    return { error: "no-task", message: `No asset task ${taskId}.` };
  }
  const rows = await prisma.marketingAssetVariant.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: { variantId: true, label: true, impressions: true, clicks: true, conversions: true, status: true },
  });
  const summary = summarizeVariants(rows);
  return { message: `${rows.length} variant(s) for "${task.title}". ${summary.rationale}`, data: summary };
}
