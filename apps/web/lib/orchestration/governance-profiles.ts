// apps/web/lib/orchestration/governance-profiles.ts
// Governance-derived runtime budgets for orchestration primitives.
// See: docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md §Governance Profile Registry

import type { GovernanceProfile, RunContext } from "./types";

export type ProfileBudget = {
  maxAttempts: number;
  tokenBudget: number;
  deadlineMs: number;
  heartbeatMs: number;
};

// Numbers chosen per spec §Governance Profile Registry rationale.
// Tuned in code under review, not exposed as runtime knobs.
export const GOVERNANCE_PROFILES: Record<GovernanceProfile, ProfileBudget> = {
  economy:                { maxAttempts: 2, tokenBudget:  20_000, deadlineMs:  60_000, heartbeatMs: 10_000 },
  balanced:               { maxAttempts: 4, tokenBudget:  80_000, deadlineMs: 300_000, heartbeatMs: 10_000 },
  "high-assurance":       { maxAttempts: 6, tokenBudget: 250_000, deadlineMs: 900_000, heartbeatMs: 15_000 },
  "document-authority":   { maxAttempts: 3, tokenBudget: 120_000, deadlineMs: 600_000, heartbeatMs: 10_000 },
  // system.tokenBudget: 0 — infra polling, not model calls. Field exists for shape uniformity.
  system:                 { maxAttempts: 3, tokenBudget:       0, deadlineMs:  60_000, heartbeatMs:  5_000 },
};

export function resolveBudget(ctx: RunContext): ProfileBudget {
  const budget = GOVERNANCE_PROFILES[ctx.governanceProfile];
  if (!budget) {
    throw new Error(
      `unknown governance profile: ${String(ctx.governanceProfile)} (valid: ${Object.keys(GOVERNANCE_PROFILES).join(", ")})`,
    );
  }
  return budget;
}

// Derives a GovernanceProfile from an AgentGovernanceProfile row.
// document-authority is selected explicitly via Rule 1 (call-site pass-through), not derived.
export function deriveGovernanceProfile(g: {
  autonomyLevel: string;
  hitlPolicy: string;
  maxDelegationRiskBand?: string | null;
}): GovernanceProfile {
  if (g.hitlPolicy === "always" || g.autonomyLevel === "supervised") return "high-assurance";
  if (g.autonomyLevel === "constrained") return "balanced";
  if (g.autonomyLevel === "autonomous" && g.maxDelegationRiskBand === "low") return "economy";
  return "balanced";
}
