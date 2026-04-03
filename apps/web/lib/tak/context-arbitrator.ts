// apps/web/lib/tak/context-arbitrator.ts
//
// EP-CTX-001: Context budget and arbitration layer.
// Governs what data enters the AI coworker's system prompt by enforcing
// per-model-tier token budgets and priority-based source selection.

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContextTier = "L0" | "L1" | "L2";
// L3/L4 are never pre-injected — they are tool-retrieved on demand.

export type ContextSource = {
  tier: ContextTier;
  priority: number;           // Lower = higher priority (0 is highest)
  content: string;            // Full content to inject
  tokenCount: number;         // Pre-computed via countTokens()
  source: string;             // Debug label: "identity", "knowledge", "page-data", etc.
  compressible: boolean;      // Can this be shortened if over budget?
  compressedContent?: string; // Shorter fallback version
  compressedTokenCount?: number;
};

export type ContextBudget = {
  modelTier: ModelTier;
  totalBudget: number;
  l0Budget: number;
  l1Budget: number;
  l2Budget: number;
};

export type ModelTier = "frontier" | "strong" | "adequate" | "basic";

// ─── Token Counting ─────────────────────────────────────────────────────────

/**
 * Lightweight token estimate: ~4 characters per token.
 * Good enough for budget arbitration across all providers.
 * Exact billing counts come from the inference response, not here.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Budget Definitions ─────────────────────────────────────────────────────

const BUDGETS: Record<ModelTier, ContextBudget> = {
  frontier: { modelTier: "frontier", totalBudget: 6000, l0Budget: 625, l1Budget: 1500, l2Budget: 3875 },
  strong:   { modelTier: "strong",   totalBudget: 3000, l0Budget: 625, l1Budget: 800,  l2Budget: 1575 },
  adequate: { modelTier: "adequate", totalBudget: 1500, l0Budget: 625, l1Budget: 500,  l2Budget: 375 },
  basic:    { modelTier: "basic",    totalBudget: 800,  l0Budget: 625, l1Budget: 175,  l2Budget: 0 },
};

export function getBudgetForTier(modelTier: ModelTier): ContextBudget {
  return BUDGETS[modelTier] ?? BUDGETS.strong;
}

// ─── Arbitration ────────────────────────────────────────────────────────────

export type ArbitrationResult = {
  selected: ContextSource[];
  dropped: ContextSource[];
  totalTokens: number;
  budgetUtilization: number;  // 0.0 to 1.0+
};

/**
 * Select context sources that fit within the token budget.
 *
 * Algorithm:
 * 1. Always include L0 sources (identity, authority, mode, sensitivity)
 * 2. Include L1 sources in priority order up to l1Budget
 * 3. Include L2 sources in priority order up to l2Budget
 * 4. If a source exceeds remaining budget and is compressible, try compressed version
 * 5. If still over, drop the source
 */
export function arbitrate(
  sources: ContextSource[],
  budget: ContextBudget,
): ArbitrationResult {
  const selected: ContextSource[] = [];
  const dropped: ContextSource[] = [];

  // Partition by tier
  const l0 = sources.filter((s) => s.tier === "L0").sort((a, b) => a.priority - b.priority);
  const l1 = sources.filter((s) => s.tier === "L1").sort((a, b) => a.priority - b.priority);
  const l2 = sources.filter((s) => s.tier === "L2").sort((a, b) => a.priority - b.priority);

  // L0: always include — these are non-negotiable
  let l0Used = 0;
  for (const src of l0) {
    selected.push(src);
    l0Used += src.tokenCount;
  }

  // L1: include in priority order up to budget
  let l1Used = 0;
  for (const src of l1) {
    if (l1Used + src.tokenCount <= budget.l1Budget) {
      selected.push(src);
      l1Used += src.tokenCount;
    } else if (src.compressible && src.compressedContent && src.compressedTokenCount !== undefined) {
      if (l1Used + src.compressedTokenCount <= budget.l1Budget) {
        selected.push({
          ...src,
          content: src.compressedContent,
          tokenCount: src.compressedTokenCount,
        });
        l1Used += src.compressedTokenCount;
      } else {
        dropped.push(src);
      }
    } else {
      dropped.push(src);
    }
  }

  // L2: include in priority order up to budget
  // Unused L1 budget rolls into L2
  const l2Ceiling = budget.l2Budget + Math.max(0, budget.l1Budget - l1Used);
  let l2Used = 0;
  for (const src of l2) {
    if (l2Used + src.tokenCount <= l2Ceiling) {
      selected.push(src);
      l2Used += src.tokenCount;
    } else if (src.compressible && src.compressedContent && src.compressedTokenCount !== undefined) {
      if (l2Used + src.compressedTokenCount <= l2Ceiling) {
        selected.push({
          ...src,
          content: src.compressedContent,
          tokenCount: src.compressedTokenCount,
        });
        l2Used += src.compressedTokenCount;
      } else {
        dropped.push(src);
      }
    } else {
      dropped.push(src);
    }
  }

  const totalTokens = l0Used + l1Used + l2Used;

  return {
    selected,
    dropped,
    totalTokens,
    budgetUtilization: totalTokens / budget.totalBudget,
  };
}

// ─── Route-to-Tier Mapping ──────────────────────────────────────────────────

/**
 * Derive the model tier from the route context.
 * Matches the agent routing in agent-routing.ts ROUTE_AGENT_MAP.
 */
export function inferModelTierFromRoute(routeContext: string): ModelTier {
  if (routeContext.startsWith("/build")) return "frontier";
  if (routeContext.startsWith("/setup")) return "basic";
  return "strong"; // Default for all other routes
}

// ─── Debug Logging ──────────────────────────────────────────────────────────

/**
 * Format arbitration result for debug logging.
 * Only call in development — skipped in production.
 */
export function formatArbitrationLog(result: ArbitrationResult, budget: ContextBudget): string {
  const lines = [
    `[context-arbitrator] model=${budget.modelTier} budget=${budget.totalBudget} used=${result.totalTokens} (${Math.round(result.budgetUtilization * 100)}%)`,
  ];

  const byTier: Record<string, string[]> = { L0: [], L1: [], L2: [] };
  for (const s of result.selected) {
    byTier[s.tier]?.push(`${s.source}=${s.tokenCount}`);
  }

  for (const [tier, entries] of Object.entries(byTier)) {
    if (entries.length > 0) {
      const total = result.selected
        .filter((s) => s.tier === tier)
        .reduce((sum, s) => sum + s.tokenCount, 0);
      lines.push(`  ${tier}: ${entries.join(" ")} (total=${total})`);
    }
  }

  if (result.dropped.length > 0) {
    const droppedStr = result.dropped.map((s) => `${s.source}(${s.tokenCount})`).join(" ");
    lines.push(`  dropped: ${droppedStr}`);
  }

  return lines.join("\n");
}
