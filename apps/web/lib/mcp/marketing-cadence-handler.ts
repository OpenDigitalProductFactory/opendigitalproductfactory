// Marketing cadence handler (BI-C26FE785), extracted from marketing-ops-pack.ts
// to keep that pack under the module-size ceiling. Lives beside the other
// lib/mcp/*-handler(s).ts modules (build-design-review-handler,
// deliberation-handlers) rather than inside packs/, so it does not inflate the
// tool-surface pack count with a file that defines no tools. Follows the same
// one-handler-per-module shape as those siblings.
//
// This is the seam where the marketing-campaign proactivity posture becomes an
// actual scheduling decision. The boundary it honours: cadence only. Deciding
// WHEN to prepare creative is the coworker's call; publishing it is not. Drafts
// planned here still land in the approval queue at pending-review, per
// docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md.

import type { ToolResult } from "@/lib/mcp-tools";

export type MarketingToolContext = {
  agentId?: string | null;
  routeContext?: string | null;
};

export async function planUpcomingMarketingDraftsHandler(
  _params: Record<string, unknown>,
  _userId: string,
  context?: MarketingToolContext,
): Promise<ToolResult> {
  const { planUpcomingForAssetTasks } = await import("@/lib/marketing/scheduler");
  const { resolveProactivityPlan } = await import("@/lib/proactivity/proactivity-resolver");
  const { prisma } = await import("@dpf/db");

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return { success: false, message: "No organization configured.", error: "no_org" };
  }

  const plan = resolveProactivityPlan({
    activityFamily: "marketing-campaign",
    agentId: context?.agentId ?? null,
    routeContext: context?.routeContext ?? null,
  });

  const result = await planUpcomingForAssetTasks({
    organizationId: org.id,
    proactivity: { level: plan.resolvedLevel, policyId: plan.policyId },
  });

  const proactivity = { level: plan.resolvedLevel, policyId: plan.policyId };

  if (result.suppressedByPosture) {
    return {
      success: true,
      message: `No drafter runs planned — marketing proactivity is set to quiet, so campaign work is prepared only when you ask. ${plan.explanation}`,
      data: { ...result, proactivity },
    };
  }

  return {
    success: true,
    message: `Scheduled ${result.scheduled} drafter run${result.scheduled === 1 ? "" : "s"} ${result.advanceDays} days ahead of their due windows; skipped ${result.skipped}. Drafts go to the approval queue, not out.`,
    data: { ...result, proactivity },
  };
}
