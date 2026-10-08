"use server";

// BI-7BCC87BB (approval convergence PR-B, spec D2 S3): an activity-routing
// override is the operator's own decision on /platform/ai/operations-map, not a
// coworker action, so it is a confirm rather than a two-step proposal. The
// confirm runs `activity_harness_confidence_override` through the reference
// monitor as the signed-in person (no agent, source rest: the same
// view_platform can() decision the approval made before, now with the
// monitor's audit row). On success the override is kept as a durable
// configuration fact (UserFact, category activity-routing-override, keyed by
// activity class and recipe, superseded on change), following the
// persistProactivityFact pattern. Readers union these facts with legacy
// approved proposals (activity-harness-approval-source.ts), so an override
// approved before the change keeps applying.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY,
  activityHarnessProposalParameters,
  type BuildActivityHarnessApprovalProposalCommandInput,
} from "@/lib/routing/activity-harness-approval-source";
import { prisma } from "@dpf/db";

const ACTIVITY_ROUTING_ROUTE_CONTEXT = "/platform/ai/operations-map";
const ACTIVITY_ROUTING_AGENT_ID = "activity-routing-governor";

type ConfirmActivityHarnessOverrideResult =
  | { success: true; overrideId: string }
  | { success: false; error: string };

export async function confirmActivityHarnessOverrideAction(
  input: BuildActivityHarnessApprovalProposalCommandInput,
): Promise<ConfirmActivityHarnessOverrideResult> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { success: false, error: "Unauthorized" };

  const rawParams = activityHarnessProposalParameters(input);
  const { governedExecuteTool } = await import("@/lib/mcp-governed-execute");
  const result = await governedExecuteTool({
    toolName: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
    rawParams,
    userId: user.id,
    userContext: { userId: user.id, platformRole: user.platformRole ?? null, isSuperuser: user.isSuperuser === true },
    context: { routeContext: ACTIVITY_ROUTING_ROUTE_CONTEXT },
    source: "rest",
  });
  if (!result.success) {
    return { success: false, error: result.message ?? result.error ?? "The override was not applied." };
  }

  const key = `${input.activityClass}|${input.harnessRecipeKey}`;
  const now = new Date();
  const value = JSON.stringify({
    proposalId: input.proposalId,
    activityClass: input.activityClass,
    harnessRecipeKey: input.harnessRecipeKey,
    providerId: input.providerId,
    modelId: input.modelId,
    confidence: input.confidence,
    approvedAt: now.toISOString(),
  });
  // One live override per activity and recipe: a newer confirm by anyone supersedes the rest.
  await prisma.userFact.updateMany({
    where: { category: ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY, key, supersededAt: null, NOT: { userId: user.id } },
    data: { supersededAt: now },
  });
  const existing = await prisma.userFact.findFirst({
    where: { userId: user.id, category: ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY, key, supersededAt: null },
    select: { id: true },
  });
  const data = { value, confidence: 1, sourceRoute: ACTIVITY_ROUTING_ROUTE_CONTEXT, sourceAgentId: ACTIVITY_ROUTING_AGENT_ID };
  if (existing) {
    await prisma.userFact.update({ where: { id: existing.id }, data });
  } else {
    await prisma.userFact.create({ data: { userId: user.id, category: ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY, key, ...data } });
  }

  revalidatePath(ACTIVITY_ROUTING_ROUTE_CONTEXT);
  return { success: true, overrideId: input.proposalId };
}
