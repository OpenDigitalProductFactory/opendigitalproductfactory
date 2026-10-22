// apps/web/lib/inference/budget-gate.ts
// Pre-call budget gate for the AI inference layer.
//
// Reads today's token totals from TokenUsage and compares them against the
// agent's configured daily_limit (from agent_registry.json or the DB).
// Events are written to AgentBudgetEvent for audit and alerting.
//
// EP-COST-001 Phase 2 — spec §3 Budget Gate

import { prisma } from "@dpf/db";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import type { ReassessmentBudgetConfiguration, ReassessmentRecordedBudgetLimits } from "../shared/reassessment-budget-contract";
export type { ReassessmentBudgetConfiguration, ReassessmentRecordedBudgetLimits } from "../shared/reassessment-budget-contract";

function currentRegistry(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(/* turbopackIgnore: true */ "@dpf/db/data/agent_registry.json");
}

function readRecordedLimits(input: {
  dailyTokenLimit?: unknown; perTaskTokenLimit?: unknown; timeoutSeconds?: unknown;
  maxTokens?: unknown; executionType?: unknown;
}): ReassessmentRecordedBudgetLimits {
  const { dailyTokenLimit, perTaskTokenLimit, timeoutSeconds, maxTokens, executionType } = input;
  if (![dailyTokenLimit, perTaskTokenLimit].every(value => Number.isSafeInteger(value) && (value as number) >= 0)
    || ![timeoutSeconds, maxTokens].every(value => Number.isSafeInteger(value) && (value as number) > 0)
    || !Number.isSafeInteger((timeoutSeconds as number) * 1000) || executionType !== "in_process") {
    throw new Error("Current review budget execution limits are missing or invalid");
  }
  return { dailyTokenLimit: dailyTokenLimit as number, perTaskTokenLimit: perTaskTokenLimit as number,
    timeoutSeconds: timeoutSeconds as number, maxTokens: maxTokens as number, executionType };
}

const budgetDigest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0;
// Only an explicitly recorded zero means unlimited; any finite owner wins.
const intersectTokenLimit = (left: number, right: number) => left === 0 ? right : right === 0 ? left : Math.min(left, right);

/** Missing current policy is never unlimited. The canonical row is read afresh,
 * including immediately before each provider start; the seed is no live proof. */
export async function readReassessmentBudgetConfiguration(
  agentId: string,
  loadRegistry: () => unknown = currentRegistry,
): Promise<ReassessmentBudgetConfiguration> {
  type Agent = { agent_id?: string; agent_name?: string; config_profile?: {
    token_budget?: { daily_limit?: number; per_task_limit?: number };
    execution_runtime?: { type?: string; timeout_seconds?: number };
    model_binding?: { max_tokens?: number };
  } };
  const registry = loadRegistry() as { agents?: Agent[] } | null;
  if (!registry || !Array.isArray(registry.agents)) throw new Error("Current review budget configuration is unavailable");
  const matches = registry.agents.filter(agent => agent?.agent_name === agentId || agent?.agent_id === agentId);
  if (matches.length !== 1 || !nonempty(matches[0].agent_name) || !nonempty(matches[0].agent_id)) {
    throw new Error("Current review budget agent is unproven");
  }
  const agent = matches[0];
  const registryLimits = readRecordedLimits({ dailyTokenLimit: agent.config_profile?.token_budget?.daily_limit,
    perTaskTokenLimit: agent.config_profile?.token_budget?.per_task_limit,
    timeoutSeconds: agent.config_profile?.execution_runtime?.timeout_seconds,
    maxTokens: agent.config_profile?.model_binding?.max_tokens, executionType: agent.config_profile?.execution_runtime?.type });
  const current = await prisma.agent.findUnique({ where: { agentId: agent.agent_id! },
    select: { id: true, agentId: true, executionConfig: { select: { id: true, agentId: true,
      dailyTokenLimit: true, perTaskTokenLimit: true, timeoutSeconds: true, maxTokens: true, executionType: true } } } });
  const config = current?.executionConfig;
  if (!current || current.agentId !== agent.agent_id || !nonempty(current.id)
    || !config || !nonempty(config.id) || config.agentId !== current.id) {
    throw new Error("Current review budget execution configuration is unavailable or mismatched");
  }
  const executionConfigLimits = readRecordedLimits(config);
  const snapshot = { source: "registry-and-execution-config" as const, agentId,
    registryAgentId: agent.agent_id!, registryAgentName: agent.agent_name!,
    executionAgentRowId: current.id, executionConfigId: config.id, registryLimits, executionConfigLimits,
    registryConfigurationDigest: budgetDigest({ agentId: agent.agent_id, agentName: agent.agent_name, limits: registryLimits }),
    executionConfigurationDigest: budgetDigest({ agentId: current.agentId, agentRowId: current.id,
      executionConfigId: config.id, limits: executionConfigLimits }),
    configuredDailyLimit: intersectTokenLimit(registryLimits.dailyTokenLimit, executionConfigLimits.dailyTokenLimit),
    configuredPerTaskLimit: intersectTokenLimit(registryLimits.perTaskTokenLimit, executionConfigLimits.perTaskTokenLimit),
    configuredTimeoutMs: Math.min(registryLimits.timeoutSeconds, executionConfigLimits.timeoutSeconds) * 1000,
    configuredMaxOutputTokens: Math.min(registryLimits.maxTokens, executionConfigLimits.maxTokens) };
  return { ...snapshot, configurationDigest: budgetDigest(snapshot) };
}

/** Read authenticated current totals; transport/owner errors must refuse execution. */
export async function checkReassessmentBudget(config: ReassessmentBudgetConfiguration): Promise<BudgetCheckResult> {
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const usageAgentIds = [...new Set([config.agentId, config.registryAgentId, config.registryAgentName])];
  const result = await prisma.tokenUsage.aggregate({ where: { agentId: { in: usageAgentIds }, createdAt: { gte: todayStart } },
    _sum: { inputTokens: true, outputTokens: true } });
  const amounts = [result._sum.inputTokens, result._sum.outputTokens];
  if (!amounts.every(value => value === null || Number.isSafeInteger(value) && value! >= 0)) {
    throw new Error("Current review usage is invalid");
  }
  const actualTokens = (amounts[0] ?? 0) + (amounts[1] ?? 0);
  const ratio = config.configuredDailyLimit === 0 ? 0 : actualTokens / config.configuredDailyLimit;
  if (ratio >= 1) throw new Error("Current review daily budget is exhausted");
  return { status: ratio >= .95 ? "warning_95" : ratio >= .8 ? "warning_80" : "ok", actualTokens,
    limitTokens: config.configuredDailyLimit, ratioPercent: Math.round(ratio * 100) };
}

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
 * True when the provider's usage is funded by a subscription or prepaid
 * commitment rather than billed per token. Unknown providers are treated as
 * metered, so a missing finance profile can never silently zero out real spend.
 */
async function isCommitmentFunded(providerId: string): Promise<boolean> {
  try {
    const finance = await prisma.aiProviderFinanceProfile.findUnique({
      where: { providerId },
      select: { valuationMethod: true },
    });
    return finance?.valuationMethod === "commitment_first";
  } catch {
    return false;
  }
}

/**
 * Resolve the blended per-token CASH cost for a given model/provider pair.
 *
 * `AgentBudgetEvent.amountUsd` means money leaving the business, so the
 * published per-token rate is only the answer when we are billed per token.
 * Under a subscription or prepaid commitment the tokens are already bought:
 * the marginal call costs nothing extra, and charging it the list rate
 * invents spend that no invoice will ever show. The install records which
 * regime a provider is on in `AiProviderFinanceProfile.valuationMethod`
 * (`metered` vs `commitment_first`), so consult that before pricing.
 *
 * The list rate still matters — it is what routing ranks models on, and what
 * tells us whether a commitment is earning its keep — but that is a different
 * question from cash, and it is not this field.
 *
 * Prefers ModelProfile prices; falls back to ModelProvider; falls back to
 * $3/MTok blended average. Returns cost-per-token, not per-million-token.
 */
async function resolveBlendedCostPerToken(
  providerId: string | undefined,
  modelId: string | undefined,
): Promise<number> {
  const FALLBACK_PER_MTOKEN = 3; // $3/MTok — conservative blended average
  try {
    if (providerId && (await isCommitmentFunded(providerId))) {
      // Already paid for under a plan — no incremental cash for this call.
      return 0;
    }
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
