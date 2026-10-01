// Consolidation-bet dispatch harness (BI-C350F8B0, EP-8DC217EB BET-0d).
//
// Routes a consolidation bet to its WSID-profiled coworker via Build Studio:
// bet → profession (bet-professions.ts) → coworker (profession registry
// roles[] → live Agent row) → promote each eligible backlog item into a Build
// Studio draft through the SAME governed core the promote_to_build_studio
// tool uses (promoteBacklogItemToBuildDraft — WIP cap, governed auto-approve,
// Ideate auto-dispatch).
//
// Deliberately THIN: the Inside-Out workflow primitives (agent-authored
// orchestration / user-definable workflow) are not built yet, so this is a
// composition of existing lib functions with attribution — when the workflow
// primitive lands, this harness becomes an instance of it, not a rival.

import { prisma } from "@dpf/db";

import { getConsolidationBet } from "./consolidation-bets";
import { professionsForBet } from "./bet-professions";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";
import { promoteBacklogItemToBuildDraft } from "@/lib/governed-backlog-tee-up";

export type DispatchSkipReason =
  | "not-open"
  | "not-triaged-build"
  | "already-has-active-build"
  | "not-found"
  | "promotion-error";

export type BetDispatchResult = {
  betKey: string;
  professionKey: string | null;
  coworker: { agentId: string; name: string; slugId: string | null } | null;
  promoted: Array<{ itemId: string; buildId: string; ideateDispatched: boolean }>;
  skipped: Array<{ itemId: string; reason: DispatchSkipReason; detail?: string }>;
};

/**
 * Resolve the live coworker for a profession family: the first `roles[]`
 * entry that matches an existing Agent row (by slugId or agentId). Registry
 * order is the preference order.
 */
export async function resolveCoworkerForProfession(
  professionKey: string,
): Promise<{ agentId: string; name: string; slugId: string | null } | null> {
  const family = PROFESSION_REGISTRY.families.find(
    (candidate) => candidate.professionKey === professionKey,
  );
  if (!family) return null;

  for (const role of family.roles) {
    const agent = await prisma.agent.findFirst({
      where: { OR: [{ slugId: role }, { agentId: role }] },
      select: { agentId: true, name: true, slugId: true },
    });
    if (agent) return agent;
  }
  return null;
}

/**
 * Dispatch one consolidation bet: promote its open, build-triaged backlog
 * items into Build Studio drafts, attributed to the bet's primary-profession
 * coworker. Items that are not eligible are reported, never silently skipped.
 */
export async function dispatchConsolidationBet(input: {
  betKey: string;
  userId: string;
}): Promise<BetDispatchResult | { error: string; message: string }> {
  const bet = getConsolidationBet(input.betKey);
  if (!bet) {
    return { error: "unknown_bet", message: `${input.betKey} is not a registered consolidation bet.` };
  }

  const professionKeys = professionsForBet(input.betKey);
  const professionKey = professionKeys[0] ?? null;
  const coworker = professionKey ? await resolveCoworkerForProfession(professionKey) : null;

  const governedConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { governedBacklogEnabled: true },
  });
  const governedBacklogEnabled = governedConfig?.governedBacklogEnabled === true;

  const promoted: BetDispatchResult["promoted"] = [];
  const skipped: BetDispatchResult["skipped"] = [];

  for (const itemId of bet.backlogItemIds) {
    const item = await prisma.backlogItem.findUnique({
      where: { itemId },
      select: { itemId: true, status: true, triageOutcome: true, activeBuildId: true },
    });
    if (!item) {
      skipped.push({ itemId, reason: "not-found" });
      continue;
    }
    if (item.status !== "open") {
      skipped.push({ itemId, reason: "not-open", detail: item.status });
      continue;
    }
    if (item.triageOutcome !== "build") {
      skipped.push({ itemId, reason: "not-triaged-build", detail: item.triageOutcome ?? "untriaged" });
      continue;
    }
    if (item.activeBuildId) {
      skipped.push({ itemId, reason: "already-has-active-build", detail: item.activeBuildId });
      continue;
    }

    // Admission by points in flight (BI-3430B3A4), re-checked per item because
    // each promotion adds points. dispatch-bet is autonomous: refused past the
    // allowance, with the reason recorded on the item.
    const { evaluateItemAdmission, recordAdmissionOutcome, blocksStart } = await import("@/lib/build/investment-admission");
    const admission = await evaluateItemAdmission(prisma as never, { itemId, startKind: "autonomous" });
    await recordAdmissionOutcome(prisma as never, admission, { source: "dispatch-bet", userId: input.userId });
    if (blocksStart(admission)) {
      skipped.push({ itemId, reason: "promotion-error", detail: `wip_allowance_reached: ${admission.reason}` });
      continue;
    }

    const result = await prisma.$transaction(async (tx) =>
      promoteBacklogItemToBuildDraft({
        tx,
        itemId,
        userId: input.userId,
        governedBacklogEnabled,
      }),
    );

    if (result.kind === "error") {
      skipped.push({ itemId, reason: "promotion-error", detail: result.error });
      continue;
    }

    let ideateDispatched = false;
    if (result.autoApprovedDispatchEligible) {
      ideateDispatched = true;
      void (async () => {
        try {
          const { dispatchIdeateForApprovedBuild } = await import("@/lib/build/ideate-on-approval");
          await dispatchIdeateForApprovedBuild({ buildId: result.build.buildId, userId: input.userId });
        } catch (err) {
          console.error(
            "[dispatch-bet] auto-dispatch Ideate failed:",
            { buildId: result.build.buildId },
            err,
          );
        }
      })();
    }

    promoted.push({ itemId, buildId: result.build.buildId, ideateDispatched });
  }

  console.info(
    `[tool-trace] vertint.dispatch ${JSON.stringify({
      betKey: bet.betKey,
      professionKey,
      coworkerAgentId: coworker?.agentId ?? null,
      promoted: promoted.map((entry) => entry.itemId),
      skipped: skipped.map((entry) => `${entry.itemId}:${entry.reason}`),
    })}`,
  );

  return { betKey: bet.betKey, professionKey, coworker, promoted, skipped };
}
