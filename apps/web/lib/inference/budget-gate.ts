// apps/web/lib/inference/budget-gate.ts
// Pre-call budget gate for the AI inference layer.
//
// Reads today's token totals from TokenUsage and compares them against the
// agent's configured daily_limit (from agent_registry.json or the DB).
// Events are written to AgentBudgetEvent for audit and alerting.
//
// EP-COST-001 Phase 2 — spec §3 Budget Gate

import { prisma } from "@dpf/db";

export type BudgetStatus =
  | "ok"          // < 80% of daily limit
  | "warning_80"  // 80–95% — warn in logs, continue normally
  | "warning_95"  // 95–100% — warn + downgrade to routine-tier model if possible
  | "rejected";   // ≥ 100% — throw InferenceError("billing")

export type BudgetCheckResult = {
  status: BudgetStatus;
  actualTokens: number;
  limitTokens: number;
  ratioPercent: number;
};

/**
 * Checks an agent's daily token budget against today's actual usage.
 *
 * @param agentId   The agent to check (from attribution context)
 * @param dailyLimit  The agent's token_budget.daily_limit from registry
 * @returns BudgetCheckResult describing whether the call should proceed
 */
export async function checkAgentBudget(
  agentId: string,
  dailyLimit: number,
): Promise<BudgetCheckResult> {
  if (dailyLimit <= 0) {
    // No limit configured — always ok
    return { status: "ok", actualTokens: 0, limitTokens: dailyLimit, ratioPercent: 0 };
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const agg = await prisma.tokenUsage.aggregate({
    where: { agentId, createdAt: { gte: todayStart } },
    _sum: { inputTokens: true, outputTokens: true },
  });

  const actualTokens =
    (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
  const ratio = actualTokens / dailyLimit;
  const ratioPercent = Math.round(ratio * 100);

  let status: BudgetStatus = "ok";
  if (ratio >= 1.0) status = "rejected";
  else if (ratio >= 0.95) status = "warning_95";
  else if (ratio >= 0.80) status = "warning_80";

  return { status, actualTokens, limitTokens: dailyLimit, ratioPercent };
}

export type BudgetEventKind =
  | "warning_80"
  | "warning_95"
  | "rejected"
  | "downgrade";

/**
 * Persists an AgentBudgetEvent row. Fire-and-forget — a DB error here must
 * never block an inference call.
 */
/**
 * Resolve the blended per-token cost for a given model/provider pair.
 * Prefers ModelProfile.inputPricePerMToken when available; falls back to
 * ModelProvider.inputPricePerMToken; falls back to $3/MTok blended average.
 * Returns cost-per-token (not per-million-token).
 */
async function resolveBlendedCostPerToken(
  providerId: string | undefined,
  modelId: string | undefined,
): Promise<number> {
  const FALLBACK_PER_MTOKEN = 3; // $3/MTok — conservative blended average
  try {
    if (providerId && modelId) {
      const profile = await prisma.modelProfile.findUnique({
        where: { providerId_modelId: { providerId, modelId } },
        select: { inputPricePerMToken: true, outputPricePerMToken: true },
      });
      const profileInput = profile?.inputPricePerMToken;
      const profileOutput = profile?.outputPricePerMToken;
      if (profileInput != null && profileOutput != null) {
        // Blended: assume ~60% input, ~40% output (typical for inference workloads)
        return ((profileInput * 0.6 + profileOutput * 0.4) / 1_000_000);
      }
    }
    if (providerId) {
      const provider = await prisma.modelProvider.findUnique({
        where: { providerId },
        select: { inputPricePerMToken: true, outputPricePerMToken: true },
      });
      const inp = provider?.inputPricePerMToken;
      const out = provider?.outputPricePerMToken;
      if (inp != null && out != null) {
        return ((inp * 0.6 + out * 0.4) / 1_000_000);
      }
    }
  } catch {
    // Non-fatal — fall through to fallback
  }
  return FALLBACK_PER_MTOKEN / 1_000_000;
}

/**
 * Persists an AgentBudgetEvent row. Fire-and-forget — a DB error here must
 * never block an inference call.
 */
export async function writeBudgetEvent(params: {
  agentId: string;
  eventKind: BudgetEventKind;
  actualTokens: number;
  limitTokens: number;
  modelId?: string;
  providerId?: string;
  buildRunId?: string;
}): Promise<void> {
  // Resolve the actual blended cost rate for this model/provider pair.
  // Falls back through: ModelProfile → ModelProvider → $3/MTok blended average.
  const costPerToken = await resolveBlendedCostPerToken(params.providerId, params.modelId);
  await prisma.agentBudgetEvent.create({
    data: {
      agentId: params.agentId,
      eventKind: params.eventKind,
      amountUsd: params.actualTokens * costPerToken,
      tokensTotal: params.actualTokens,
      modelId: params.modelId ?? null,
      providerId: params.providerId ?? null,
      buildRunId: params.buildRunId ?? null,
    },
  }).catch((err) => {
    console.error("[budget-gate] Failed to write budget event:", { agentId: params.agentId, eventKind: params.eventKind }, err);
  });
}

/**
 * Returns the daily_limit for a named agent from the agent registry JSON.
 * Returns 0 (unlimited) if the agent is not found or has no budget configured.
 *
 * Intentionally synchronous-safe — the JSON is loaded once at module scope.
 */
let _registryCache: Record<string, number> | null = null;

function getAgentDailyLimitFromRegistry(agentId: string): number {
  if (!_registryCache) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const registry = require(/* turbopackIgnore: true */ "@dpf/db/data/agent_registry.json") as {
        agents?: Array<{
          agent_name?: string;
          config_profile?: { token_budget?: { daily_limit?: number } };
        }>;
      };
      _registryCache = {};
      for (const agent of registry.agents ?? []) {
        const name = agent.agent_name;
        const limit = agent.config_profile?.token_budget?.daily_limit;
        if (name && typeof limit === "number") {
          _registryCache[name] = limit;
        }
      }
    } catch {
      _registryCache = {};
    }
  }
  return _registryCache[agentId] ?? 0;
}

/**
 * Convenience: look up the agent's registry limit and run a budget check.
 * Returns "ok" immediately if no limit is configured (0 = unlimited).
 */
export async function checkAgentBudgetFromRegistry(
  agentId: string,
): Promise<BudgetCheckResult> {
  const dailyLimit = getAgentDailyLimitFromRegistry(agentId);
  if (dailyLimit <= 0) {
    return { status: "ok", actualTokens: 0, limitTokens: 0, ratioPercent: 0 };
  }
  return checkAgentBudget(agentId, dailyLimit);
}
