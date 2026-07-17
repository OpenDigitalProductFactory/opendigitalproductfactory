import type { ContributionSignalScore } from "@/lib/integrate/disposition";
import { suggestDisposition } from "@/lib/integrate/disposition";

export type ContributionReusability = {
  scope?: string;
  contributionReadiness?: string;
};

export async function deriveContributionAssessmentSignals(args: {
  brief: Record<string, unknown> | null;
  diff: string;
  reusability: ContributionReusability | undefined;
  projectViability: ContributionSignalScore;
  orgSpecificHits: number;
  hasReusabilityAnalysis: boolean;
}) {
  const contributionReadiness =
    args.reusability?.contributionReadiness === "high"
      || args.reusability?.contributionReadiness === "medium"
      || args.reusability?.contributionReadiness === "low"
      ? args.reusability.contributionReadiness
      : null;
  let reusabilityScope: "one_off" | "parameterizable" | "already_generic" | null = null;
  if (args.reusability?.scope === "one_off" || args.reusability?.scope === "parameterizable" || args.reusability?.scope === "already_generic") {
    reusabilityScope = args.reusability.scope;
  }

  let archetypeMarketFit: ContributionSignalScore = "unknown";
  let archetypeMarketReasoning = "Archetype and market fit was not assessed.";
  try {
    const { tagBusinessVerticals } = await import("@/lib/integrate/contribution-review");
    const verticals = await tagBusinessVerticals(args.brief, args.diff);
    const primary = verticals.applicableVerticals.filter((vertical) => vertical.relevance === "primary");
    const applicable = verticals.applicableVerticals.filter((vertical) => vertical.relevance === "applicable");
    archetypeMarketFit = primary.length > 0 ? "high" : applicable.length > 0 ? "medium" : "low";
    archetypeMarketReasoning = primary.length > 0
      ? `Strong fit for ${primary.map((vertical) => vertical.label).join(", ")}.`
      : applicable.length > 0
        ? `Potential fit for ${applicable.map((vertical) => vertical.label).join(", ")}.`
        : "No strong archetype or market vertical match was found.";
  } catch {
    // Optional signal; callers remain fail-closed when unknown.
  }

  const dispositionSuggestion = suggestDisposition({
    reusabilityScope,
    contributionReadiness,
    projectViability: args.projectViability,
    archetypeMarketFit,
    confidence: args.hasReusabilityAnalysis && archetypeMarketFit !== "unknown" ? "high" : "medium",
    orgSpecificHits: args.orgSpecificHits,
    outboundEmpty: !args.diff.trim(),
  });

  return { archetypeMarketFit, archetypeMarketReasoning, dispositionSuggestion };
}
