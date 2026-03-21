/**
 * EP-INF-006: Champion/Challenger selection and promotion.
 * Handles exploration traffic (2% to challengers), promotion gate evaluation,
 * and anti-thrash protection for recipe lifecycle management.
 *
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { prisma } from "@dpf/db";
import { loadChampionRecipe } from "./recipe-loader";
import type { RecipeRow } from "./recipe-types";
import type { RequestContract } from "./request-contract";

// ── Constants ────────────────────────────────────────────────────────────────

const EXPLORATION_RATE = 0.02;
const MIN_SAMPLES_FOR_PROMOTION = 20;
const MIN_REWARD_IMPROVEMENT = 0.05; // 5%
const MAX_COST_INCREASE = 0.50;      // 50%
const RETIREMENT_SAMPLE_THRESHOLD = 40; // 2× minimum
const ANTI_THRASH_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── In-memory anti-thrash state ──────────────────────────────────────────────

const lastPromotionTime = new Map<string, number>();

// ── selectRecipeWithExploration ──────────────────────────────────────────────

/**
 * Select a recipe for execution, occasionally exploring challengers.
 *
 * Returns the selected recipe and whether it is the champion or a challenger.
 * Exploration is blocked for confidential/restricted sensitivity and
 * quality_first budget class.
 */
export async function selectRecipeWithExploration(
  providerId: string,
  modelId: string,
  contract: RequestContract,
): Promise<{ recipe: RecipeRow | null; explorationMode: "champion" | "challenger" }> {
  const champion = await loadChampionRecipe(providerId, modelId, contract.contractFamily);

  if (!champion) {
    return { recipe: null, explorationMode: "champion" };
  }

  // ── Block exploration for sensitive/quality-critical requests ────────
  const sensitivityBlocked =
    contract.sensitivity === "confidential" || contract.sensitivity === "restricted";
  const budgetBlocked = contract.budgetClass === "quality_first";

  if (sensitivityBlocked || budgetBlocked) {
    return { recipe: champion, explorationMode: "champion" };
  }

  // ── Check global freeze (future extension point) ────────────────────
  // Currently no global freeze mechanism; reserved for future use.

  // ── Load challengers ────────────────────────────────────────────────
  const challengers = await prisma.executionRecipe.findMany({
    where: {
      providerId,
      modelId,
      contractFamily: contract.contractFamily,
      status: "candidate",
    },
  });

  if (challengers.length === 0) {
    return { recipe: champion, explorationMode: "champion" };
  }

  // ── Exploration roll ────────────────────────────────────────────────
  if (Math.random() < EXPLORATION_RATE) {
    const idx = Math.floor(Math.random() * challengers.length);
    return { recipe: challengers[idx] as RecipeRow, explorationMode: "challenger" };
  }

  return { recipe: champion, explorationMode: "champion" };
}

// ── evaluatePromotions ───────────────────────────────────────────────────────

/**
 * Evaluate all challenger recipes for a contract family and promote or retire
 * them based on promotion gates.
 *
 * Promotion gates:
 * - Minimum 20 samples
 * - No hard metric regression (schema valid rate, tool success rate)
 * - 5% reward improvement over champion
 * - Max 50% cost increase over champion
 *
 * Fire-and-forget: catches all errors internally.
 */
export async function evaluatePromotions(contractFamily: string): Promise<void> {
  try {
    // ── Anti-thrash check ────────────────────────────────────────────
    const lastPromo = lastPromotionTime.get(contractFamily);
    if (lastPromo && Date.now() - lastPromo < ANTI_THRASH_MS) {
      return;
    }

    // ── Load all champions for this contract family ──────────────────
    const champions = await prisma.executionRecipe.findMany({
      where: { contractFamily, status: "champion" },
    });

    for (const champion of champions) {
      // Load champion performance
      const championPerf = await prisma.recipePerformance.findUnique({
        where: {
          recipeId_contractFamily: {
            recipeId: champion.id,
            contractFamily,
          },
        },
      });

      if (!championPerf) continue;

      // Load challengers for this champion's provider+model
      const challengers = await prisma.executionRecipe.findMany({
        where: {
          providerId: champion.providerId,
          modelId: champion.modelId,
          contractFamily,
          status: "candidate",
        },
      });

      for (const challenger of challengers) {
        const challengerPerf = await prisma.recipePerformance.findUnique({
          where: {
            recipeId_contractFamily: {
              recipeId: challenger.id,
              contractFamily,
            },
          },
        });

        if (!challengerPerf) continue;

        // ── Gate: minimum samples ─────────────────────────────────
        if (challengerPerf.sampleCount < MIN_SAMPLES_FOR_PROMOTION) {
          continue;
        }

        // ── Gate: no hard metric regression ───────────────────────
        const schemaRegression =
          championPerf.avgSchemaValidRate !== null &&
          challengerPerf.avgSchemaValidRate !== null &&
          challengerPerf.avgSchemaValidRate < championPerf.avgSchemaValidRate;

        const toolRegression =
          championPerf.avgToolSuccessRate !== null &&
          challengerPerf.avgToolSuccessRate !== null &&
          challengerPerf.avgToolSuccessRate < championPerf.avgToolSuccessRate;

        const hasHardRegression = schemaRegression || toolRegression;

        // ── Gate: 5% reward improvement ───────────────────────────
        const rewardImprovement =
          championPerf.ewmaReward > 0
            ? (challengerPerf.ewmaReward - championPerf.ewmaReward) / championPerf.ewmaReward
            : challengerPerf.ewmaReward > 0 ? 1 : 0;

        const hasRewardImprovement = rewardImprovement >= MIN_REWARD_IMPROVEMENT;

        // ── Gate: max 50% cost increase ───────────────────────────
        const costIncrease =
          championPerf.avgCostUsd > 0
            ? (challengerPerf.avgCostUsd - championPerf.avgCostUsd) / championPerf.avgCostUsd
            : 0;

        const costAcceptable = costIncrease <= MAX_COST_INCREASE;

        // ── Decision ──────────────────────────────────────────────
        if (!hasHardRegression && hasRewardImprovement && costAcceptable) {
          await promoteChallenger(challenger.id, champion.id);
          // Only one promotion per evaluation cycle per champion
          break;
        }

        // ── Retire stale challengers ──────────────────────────────
        if (challengerPerf.sampleCount >= RETIREMENT_SAMPLE_THRESHOLD) {
          await prisma.executionRecipe.update({
            where: { id: challenger.id },
            data: { status: "retired", retiredAt: new Date() },
          });
        }
      }
    }
  } catch {
    // Fire-and-forget — swallow all errors
  }
}

// ── promoteChallenger ────────────────────────────────────────────────────────

/**
 * Promote a challenger recipe to champion and retire the old champion.
 */
export async function promoteChallenger(
  challengerRecipeId: string,
  championRecipeId: string,
): Promise<void> {
  const now = new Date();

  await prisma.executionRecipe.update({
    where: { id: championRecipeId },
    data: { status: "retired", retiredAt: now },
  });

  await prisma.executionRecipe.update({
    where: { id: challengerRecipeId },
    data: { status: "champion", promotedAt: now },
  });

  // Record promotion time for anti-thrash
  // Look up contract family from the promoted recipe
  const promoted = await prisma.executionRecipe.findUnique({
    where: { id: challengerRecipeId },
    select: { contractFamily: true },
  });

  if (promoted) {
    lastPromotionTime.set(promoted.contractFamily, Date.now());
  }
}

// ── Test helper ──────────────────────────────────────────────────────────────

/**
 * Reset in-memory promotion state. For tests only.
 */
export function _resetPromotionState(): void {
  lastPromotionTime.clear();
}
