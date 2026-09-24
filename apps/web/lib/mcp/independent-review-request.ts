import { prisma } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tools";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { expandGrants } from "@/lib/tak/agent-grants";
import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthExecutionAuthority } from "@/lib/auth/oauth-tokens";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { canonicalJson } from "@/lib/shared/canonical-json";
import { resolveMcpTaskAuthorityKey } from "@/lib/auth/oauth-task-authority";
import { deterministicExternalTaskRunId, remoteTaskRequestMatches } from "@/lib/mcp-task-capacity-contract";
import { loadTaskInitiativeReviewOutcome } from "@/lib/mcp-task-review-outcome";

/** A finished review disappears from readiness. Replays may retrieve its real
 * writer receipt, but must never turn a stale proposal into another execution. */
async function hasCompletedReview(params: Record<string, unknown>, userId: string, context: ToolExecutionContext) {
  const binding = parseInitiativeReviewBinding(params.initiativeReviewBinding);
  const keys = ["targetAgent", "objective", "questionPacketSummary", "requestKey", "tier", "enteredVia", "requiredToolNames", "initiativeReviewBinding"];
  if (!binding || Object.keys(params).some((key) => !keys.includes(key)) || params.tier !== 2 || params.enteredVia !== "handoff"
    || typeof params.targetAgent !== "string" || typeof params.objective !== "string"
    || typeof params.questionPacketSummary !== "string" || typeof params.requestKey !== "string"
    || !Array.isArray(params.requiredToolNames) || params.requiredToolNames.some((name) => typeof name !== "string")) return false;
  const authorityKey = await resolveMcpTaskAuthorityKey({ tokenId: context.apiTokenId!, userId, source: "oauth" });
  if (!authorityKey) return false;
  const taskRunId = deterministicExternalTaskRunId(authorityKey, params.requestKey);
  const task = await prisma.taskRun.findFirst({ where: { taskRunId, userId }, select: { a2aMetadata: true } });
  const names = [...new Set(params.requiredToolNames as string[])];
  const scope = [...(context.tokenGrantScopes ?? []).filter((entry) => !entry.startsWith("tool:") && !entry.startsWith("backlog-item:")),
    `backlog-item:${binding.itemId}`, ...names.map((name) => `tool:${name}`)];
  return Boolean(task && remoteTaskRequestMatches(task.a2aMetadata, {
    agentId: params.targetAgent, routeContext: "/build", title: params.questionPacketSummary,
    objective: params.objective, prompt: params.objective, idempotencyKey: params.requestKey,
    riskClass: "bounded-write", authorityScope: scope, collaborationKind: "handoff", initiativeReviewBinding: binding,
  }) && await loadTaskInitiativeReviewOutcome(taskRunId, binding));
}

type RequestAuthority = { bounded: boolean; refusal?: ToolResult };
const deny = (message: string): RequestAuthority => ({ bounded: true, refusal: {
  success: false, error: "independent_review_request_denied", message,
  data: { action: "Refresh the item's readiness and submit its exact review request. Access to its Workroom must already be authorized." },
} });

/** An evidence author may request an independent review, never impersonate its writer.
 * The general collaboration lane is unchanged. The additional lane must match a
 * currently server-issued packet and stays on the token-bound task service even
 * when a portal thread happens to be present in the execution context. */
export async function authorizeCoworkerRequest(
  params: Record<string, unknown>, userId: string, context?: ToolExecutionContext,
): Promise<RequestAuthority> {
  // BI-817556D8: a personal access token has no acting coworker, so it can never
  // pass this guard. Say which connection can, instead of only what is missing.
  if (!context?.agentId) {
    return deny("A current acting coworker is required. Coworker and independent-review requests need an OAuth "
      + "connection bound to a coworker admitted to the item's Workroom; a personal access token cannot make them.");
  }
  // Read live grants: a cached registry fallback cannot keep revoked delegation alive.
  const agent = await prisma.agent.findUnique({ where: { agentId: context.agentId },
    select: { status: true, archived: true, toolGrants: { select: { grantKey: true } } } });
  if (!agent || agent.status !== "active" || agent.archived) return deny("The acting coworker is not active.");
  const grants = expandGrants(agent.toolGrants.map((grant) => grant.grantKey));
  const scopes = expandGrants(context.tokenGrantScopes ?? []);
  if (grants.includes("thread_write") && (!context.apiTokenId || scopes.includes("thread_write"))) {
    return { bounded: false };
  }
  if (context.authSource !== "oauth" || !context.apiTokenId
    || !["write", "admin"].includes(context.tokenScope ?? "")
    || !grants.includes("initiative_evidence_write") || !scopes.includes("initiative_evidence_write")) {
    return deny("This connection is not authorized to request an independent review.");
  }
  const token = await prisma.mcpApiToken.findUnique({ where: { id: context.apiTokenId }, select: OAUTH_EXECUTION_AUTHORITY_SELECT });
  if (!token || token.userId !== userId || token.agentId !== context.agentId || !token.authorityBindingId
    || token.oauthClient?.registrationKind === "credentials" || !await isCurrentOAuthExecutionAuthority(token)) {
    return deny("The connection's authorization is no longer current.");
  }
  const binding = parseInitiativeReviewBinding(params.initiativeReviewBinding);
  const lane = binding && INITIATIVE_READINESS_LANES[binding.writerToolName];
  if (!binding?.workroomRef || !lane?.independent || !lane.gates.some((gate) => gate === binding.gate)
    || params.targetAgent === context.agentId) return deny("Use an independent review request supplied by the item's readiness check.");
  const human = await currentUserContext(userId);
  if (!human || !can(human, "manage_backlog") || !can(human, lane.capability)) {
    return deny("Your current permissions do not authorize this review operation.");
  }
  const room = await prisma.workroom.findFirst({ where: { capsuleId: binding.workroomRef.workroomId,
    backlogItemId: binding.itemId, archivedAt: null }, select: { id: true } });
  if (!room || (await resolveAgentWorkroomAccess({ userId, agentId: context.agentId,
    workroomId: room.id, requested: "action" })).decision.level !== "action") {
    return deny("You and this coworker must both be admitted to the exact Workroom before requesting its review.");
  }
  // Reuse the canonical readiness projection and recovery issuer; client names,
  // hashes and packet-shaped JSON are never evidence of server authorization.
  const { getBacklogItem } = await import("./packs/backlog-pack-read-tools");
  const item = await getBacklogItem({ itemId: binding.itemId }, context.agentId);
  const readiness = item.data?.readiness as { decisions?: { completion?: InitiativeReadinessDecision } } | undefined;
  const decision = readiness?.decisions?.completion;
  if (!item.success || !decision) return deny("This item's readiness could not be resolved.");
  if (decision.verdict === "allowed") return await hasCompletedReview(params, userId, context)
    ? { bounded: true } : deny("This item has no pending independent completion review.");
  const { resolveTerminalInitiativeRecovery } = await import("@/lib/backlog/initiative-readiness/terminal-recovery");
  const recovery = await resolveTerminalInitiativeRecovery({ decision, currentAgentId: context.agentId,
    refusedWorkroomId: binding.workroomRef.workroomId });
  if (!recovery.reviewerRoutes.some((route) => route.independent
    && canonicalJson(route.requestCoworker) === canonicalJson(params))) {
    if (await hasCompletedReview(params, userId, context)) return { bounded: true };
    return deny("The review request has changed or is no longer eligible. Refresh readiness to get the current request.");
  }
  return { bounded: true };
}
