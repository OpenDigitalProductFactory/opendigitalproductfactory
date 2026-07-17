// Funding-risk classification for demand bets (EP-DELIVERY-FLOW).
//
// The demand funding gate rates a bet's risk tier (low|medium|high); the AI-led
// volunteering autonomy resolver maps that tier onto the governed work-management
// RiskClass so a coworker's auto-claim authority is CAPPED by how risky the bet
// is. Kept pure (no prisma) so both the demand-scoring pack (the funding gate)
// and the volunteering resolver share one source of truth for the thresholds.

import type { RiskClass } from "@/lib/autonomy/trust-graduation";

export type FundingRiskTier = "low" | "medium" | "high";

/**
 * Bet risk tier from its investment bucket + effort: transform bets and xlarge
 * work rank highest, large is medium, everything else low.
 */
export function fundingRiskTier(investmentBucket: string | null, effortSize: string | null): FundingRiskTier {
  if (investmentBucket === "transform" || effortSize === "xlarge") return "high";
  if (effortSize === "large") return "medium";
  return "low";
}

/**
 * Map a funding risk tier onto the governed RiskClass that ceilings a coworker's
 * autonomy. A funded build pickup is an internal action, so low/medium map to the
 * reversible/irreversible internal classes (ceiling autopilot — a fully trusted
 * coworker may auto-claim); a high-risk (transform / xlarge) bet maps to the
 * kernel floor (ceiling propose — even a trusted coworker must ask first).
 */
export function riskTierToRiskClass(tier: FundingRiskTier): RiskClass {
  switch (tier) {
    case "high":
      return "outbound-or-floor";
    case "medium":
      return "internal-irreversible";
    case "low":
      return "internal-reversible";
  }
}

/** The governed RiskClass for a funded item directly from its facets. */
export function fundedItemRiskClass(investmentBucket: string | null, effortSize: string | null): RiskClass {
  return riskTierToRiskClass(fundingRiskTier(investmentBucket, effortSize));
}
