// Signal (2) of the self-driving cognitive-load migration loop (BI-A028AA14,
// EP-COST-001): cost-per-reasoning-pattern ROI ranking.
//
// Pairs with signal (1) (tool-reasoning-stability): signal (1) says WHICH
// patterns are codifiable; signal (2) says which codifiable ones are worth
// codifying FIRST -- the ones burning the most capacity. Codifying a high-cost
// stabilized pattern into deterministic code saves the most (the
// responsible-capacity-utilization principle), so it ranks first.
//
// Pure stats core, source-agnostic: the caller supplies per-call cost samples
// keyed the same way signal (1) groups (agent x tool x input-shape), extracted
// from ToolExecution.costUsd (per tool call -- composes 1:1 with signal 1) or
// the finer-grained AdapterRunTelemetry. It never files anything; auto-nomination
// is founder-gated (see the keystone design pass).

export interface PatternCostSample {
  agentId: string;
  toolName: string;
  inputShape: string;
  /** USD cost of this single call (e.g. ToolExecution.costUsd); 0 if unmetered. */
  costUsd: number;
  /** Total tokens for this call (input + output); optional. */
  totalTokens?: number;
}

export interface PatternCostRollup {
  invocations: number;
  totalCostUsd: number;
  avgCostUsd: number;
  totalTokens: number;
}

/**
 * A signal-(1) codify candidate. Structurally compatible with the relevant
 * fields of ToolReasoningStability, declared locally so this module does not
 * depend on signal (1) -- the caller passes signal (1)'s "stabilized" rows.
 */
export interface CodifyCandidate {
  agentId: string;
  toolName: string;
  inputShape: string;
  recurrence: number;
}

export interface RankedCodifyCandidate extends CodifyCandidate {
  totalCostUsd: number;
  avgCostUsd: number;
  totalTokens: number;
}

function patternKey(p: { agentId: string; toolName: string; inputShape: string }): string {
  return `${p.agentId} ${p.toolName} ${p.inputShape}`;
}

/**
 * Roll up per-call cost samples into a per-(agent x tool x input-shape) summary.
 * Pure + deterministic; non-finite/negative cost or tokens are treated as 0.
 */
export function summarizeCostPerPattern(samples: PatternCostSample[]): Record<string, PatternCostRollup> {
  const acc = new Map<string, { invocations: number; totalCostUsd: number; totalTokens: number }>();

  for (const s of samples) {
    const cost = Number.isFinite(s.costUsd) && s.costUsd > 0 ? s.costUsd : 0;
    const rawTokens = s.totalTokens ?? 0;
    const tokens = Number.isFinite(rawTokens) && rawTokens > 0 ? rawTokens : 0;
    const key = patternKey(s);
    const a = acc.get(key) ?? { invocations: 0, totalCostUsd: 0, totalTokens: 0 };
    a.invocations += 1;
    a.totalCostUsd += cost;
    a.totalTokens += tokens;
    acc.set(key, a);
  }

  const out: Record<string, PatternCostRollup> = {};
  for (const [key, a] of acc) {
    out[key] = {
      invocations: a.invocations,
      totalCostUsd: a.totalCostUsd,
      avgCostUsd: a.invocations > 0 ? a.totalCostUsd / a.invocations : 0,
      totalTokens: a.totalTokens,
    };
  }
  return out;
}

/**
 * Rank codify candidates (signal 1's "stabilized" patterns) by ROI = the total
 * capacity each currently burns. Highest total cost first -- codifying those
 * deterministically saves the most. Candidates with no cost data sort last
 * (cost 0). Deterministic tie-break: recurrence desc, then key.
 */
export function rankByCodifyRoi(
  candidates: CodifyCandidate[],
  costByKey: Record<string, PatternCostRollup>,
): RankedCodifyCandidate[] {
  const ranked: RankedCodifyCandidate[] = candidates.map((c) => {
    const roll = costByKey[patternKey(c)];
    return {
      agentId: c.agentId,
      toolName: c.toolName,
      inputShape: c.inputShape,
      recurrence: c.recurrence,
      totalCostUsd: roll?.totalCostUsd ?? 0,
      avgCostUsd: roll?.avgCostUsd ?? 0,
      totalTokens: roll?.totalTokens ?? 0,
    };
  });

  ranked.sort(
    (a, b) =>
      b.totalCostUsd - a.totalCostUsd ||
      b.recurrence - a.recurrence ||
      patternKey(a).localeCompare(patternKey(b)),
  );
  return ranked;
}
