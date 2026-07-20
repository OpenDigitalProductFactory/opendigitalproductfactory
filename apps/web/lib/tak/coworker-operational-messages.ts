import { prisma } from "@dpf/db";
import { formatCoworkerOperationalMessage } from "./coworker-interaction-contract";

/**
 * Build the coworker's chat summary of the ideate-research + design-review
 * outcome using the build phase after the review tool had a chance to advance.
 */
export async function summariseIdeateOutcome(
  approach: string,
  reviewPassed: boolean,
  buildId: string,
): Promise<string> {
  let currentPhase: string | null = null;
  try {
    const refreshed = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { phase: true },
    });
    currentPhase = refreshed?.phase ?? null;
  } catch {
    // Non-fatal: the formatted fallback will name the phase as unknown.
  }

  return formatIdeateOutcomeMessage({ approach, reviewPassed, buildId, currentPhase });
}

export function formatIdeateOutcomeMessage(args: {
  approach: string;
  reviewPassed: boolean;
  buildId: string;
  currentPhase: string | null;
}): string {
  const head = `I've researched the codebase and drafted the design.\n\n**Approach:** ${args.approach.slice(0, 300)}\n\n`;

  if (!args.reviewPassed) {
    return formatCoworkerOperationalMessage({
      summary: `${head}Design review flagged issues in the draft.`,
      status: "needs revision",
      evidence: `design review did not pass for build ${args.buildId}.`,
      nextAction: "revise the design evidence and rerun the design review.",
      owner: "Build Studio ideate agent",
    });
  }

  if (args.currentPhase === "plan") {
    return formatCoworkerOperationalMessage({
      summary: `${head}Design review passed and the build advanced to the Plan phase.`,
      status: "ready for planning",
      evidence: `design review passed for build ${args.buildId}; current phase is plan.`,
      nextAction: "draft the implementation plan.",
      owner: "Build Studio planning agent",
    });
  }

  if (args.currentPhase === "ideate") {
    return formatCoworkerOperationalMessage({
      summary: `${head}Design review passed, but the phase gate is holding advance.`,
      status: "blocked before planning",
      evidence: `build ${args.buildId} is still in ideate; an intake anchor such as taxonomy, backlog, epic, or constrained goal is missing.`,
      nextAction: "complete the missing intake anchor and retry the phase advance.",
      owner: "Build Studio ideate agent",
    });
  }

  return formatCoworkerOperationalMessage({
    summary: `${head}Design review passed, but the current phase could not be confirmed.`,
    status: "needs review",
    evidence: `build ${args.buildId} phase is ${args.currentPhase ?? "unknown"} after design review.`,
    nextAction: "refresh the build phase state before proceeding.",
    owner: "Build Studio",
  });
}

export function formatIncompleteIdeateDesignMessage(buildId: string): string {
  return formatCoworkerOperationalMessage({
    summary: "The codebase research ran but did not produce a complete design.",
    status: "blocked before planning",
    evidence: `research output for build ${buildId} was missing a usable proposed approach.`,
    nextAction: "rerun ideate research with the existing build context and verify codebase access first.",
    owner: "Build Studio ideate agent",
  });
}

export function formatIdeateResearchIssueMessage(args: {
  summary: string;
  evidence: string;
  nextAction: string;
}): string {
  return formatCoworkerOperationalMessage({
    summary: args.summary,
    status: "needs revision",
    evidence: args.evidence,
    nextAction: args.nextAction,
    owner: "Build Studio ideate agent",
  });
}

export function formatIdeateResearchResultMessage(args: {
  buildId: string;
  error?: string | null;
}): string {
  if (args.error) {
    return formatCoworkerOperationalMessage({
      summary: `Research encountered an issue: ${args.error}`,
      status: "blocked before planning",
      evidence: `ideate research failed for build ${args.buildId}: ${args.error}`,
      nextAction: "rerun ideate research after confirming codebase access and provider availability.",
      owner: "Build Studio ideate agent",
    });
  }

  return formatCoworkerOperationalMessage({
    summary: "Research completed but did not generate a structured design.",
    status: "blocked before planning",
    evidence: `ideate research for build ${args.buildId} returned no structured design document.`,
    nextAction: "rerun ideate research with a narrower feature goal and save the structured design evidence.",
    owner: "Build Studio ideate agent",
  });
}

export function formatProviderUnavailableMessage(args: {
  attempts: ReadonlyArray<{ providerId: string; error: string }>;
  inactiveProviders: ReadonlyArray<{ providerId: string; name: string | null }>;
}): string {
  if (args.attempts.length > 0) {
    const failureDetails = args.attempts
      .map((attempt) => `${attempt.providerId}: ${attempt.error.slice(0, 200)}`)
      .join("; ");
    return formatCoworkerOperationalMessage({
      summary: "All AI providers failed for this coworker turn.",
      status: "blocked",
      evidence: failureDetails,
      nextAction: "restore or switch the configured AI provider in Platform > AI Providers, then retry the coworker turn.",
      owner: "operator/admin",
    });
  }

  if (args.inactiveProviders.length > 0) {
    return formatCoworkerOperationalMessage({
      summary: "AI coworkers are temporarily offline because configured providers are inactive.",
      status: "blocked",
      evidence: `${args.inactiveProviders.length} provider${args.inactiveProviders.length === 1 ? "" : "s"} are inactive: ${args.inactiveProviders.map((provider) => provider.name || provider.providerId).join(", ")}.`,
      nextAction: "reactivate a provider from Platform > AI Providers, then retry the coworker turn.",
      owner: "operator/admin",
    });
  }

  return formatCoworkerOperationalMessage({
    summary: "No AI providers are configured for coworker responses.",
    status: "blocked",
    evidence: "provider lookup found no active or inactive model providers for this route.",
    nextAction: "configure at least one AI provider in Platform > AI Providers.",
    owner: "operator/admin",
  });
}
