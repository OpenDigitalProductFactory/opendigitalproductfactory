import { prisma } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { expandGrants } from "@/lib/tak/agent-grants";
import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthExecutionAuthority } from "@/lib/auth/oauth-tokens";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { resolveMcpTaskAuthorityKey } from "@/lib/auth/oauth-task-authority";
import { deterministicExternalTaskRunId, remoteTaskRequestMatches } from "@/lib/mcp-task-capacity-contract";
import { loadTaskInitiativeReviewOutcome } from "@/lib/mcp-task-review-outcome";
import { BUILD_STUDIO_ASSISTANT_AGENT_ID, buildStudioOwedRoutes } from "@/lib/backlog/initiative-readiness/build-studio-owed-routes";

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
  options?: { sourceOnly: boolean },
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
  if (!options?.sourceOnly && grants.includes("thread_write") && (!context.apiTokenId || scopes.includes("thread_write"))) {
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
  if (options?.sourceOnly && (!binding || binding.eligibleEvidenceActivityIds?.length
    || !["record_initiative_design_review", "record_initiative_architecture_review"].includes(binding.writerToolName))) {
    return deny("This review does not have a source-only activity contract.");
  }
  if (!binding?.workroomRef || !lane?.independent || !lane.gates.some((gate) => gate === binding.gate)
    || params.targetAgent === context.agentId) return deny("Use an independent review request supplied by the item's readiness check.");
  const human = await currentUserContext(userId);
  if (!human || !can(human, "manage_backlog") || !can(human, lane.capability)) {
    return deny("Your current permissions do not authorize this review operation.");
  }
  // A Build Studio room records the item's ROW id in backlogItemId (the
  // attachment writes backlogItem.id); an adopted room records the BI- id.
  const room = await prisma.workroom.findFirst({ where: { capsuleId: binding.workroomRef.workroomId, archivedAt: null },
    select: { id: true, backlogItemId: true, executorKind: true, requestedByPrincipalId: true } });
  const roomOwnsItem = Boolean(room) && (room!.backlogItemId === binding.itemId
    || (room!.backlogItemId !== null && room!.backlogItemId === (await prisma.backlogItem.findUnique({ where: { itemId: binding.itemId }, select: { id: true } }))?.id));
  const buildStudioRoom = roomOwnsItem && room!.executorKind === "build-studio";
  // BI-926A7E90 §4: a Build Studio room's assistant holds no connection, so its
  // review request travels on a live connection of the person who requested
  // the build. That person's identity, not the carrier's admission, is the
  // room check for such a room; every other check above still applies.
  const admitted = !roomOwnsItem ? false
    : buildStudioRoom
      ? room!.requestedByPrincipalId !== null && (await prisma.principalAlias.findFirst({
        where: { aliasType: "user", aliasValue: userId, issuer: "" }, select: { principalId: true } }))?.principalId === room!.requestedByPrincipalId!
      : (await resolveAgentWorkroomAccess({ userId, agentId: context.agentId, workroomId: room!.id, requested: "action" })).decision.level === "action";
  if (!admitted) {
    return deny(buildStudioRoom
      ? "Only a connection of the person who requested this Build Studio build may request its review."
      : "You and this coworker must both be admitted to the exact Workroom before requesting its review.");
  }
  // Reuse the canonical readiness projection and recovery issuer; client names,
  // hashes and packet-shaped JSON are never evidence of server authorization.
  const { getBacklogItem } = await import("./packs/backlog-pack-read-tools");
  const item = await getBacklogItem({ itemId: binding.itemId }, context.agentId);
  if (options?.sourceOnly && item.data?.scopeKind !== "platform") {
    return deny("Source-only classification requires a platform-scoped review.");
  }
  const readiness = item.data?.readiness as { decisions?: Partial<Record<"plan" | "implementation" | "completion", InitiativeReadinessDecision>> } | undefined;
  if (!item.success || !readiness?.decisions) return deny("This item's readiness could not be resolved.");
  const { decisionForIndependentReview } = await import("@/lib/backlog/initiative-readiness/design-phase-recovery");
  const decision = decisionForIndependentReview(binding.writerToolName, readiness.decisions);
  if (!decision) return !options?.sourceOnly && await hasCompletedReview(params, userId, context)
    ? { bounded: true } : deny("This item has no pending review for the requested lane.");
  if (decision.verdict === "allowed") return !options?.sourceOnly && await hasCompletedReview(params, userId, context)
    ? { bounded: true } : deny("This item has no pending independent completion review.");
  // A Build Studio build's routes come from the same resolver the server
  // dispatcher uses, with the same author identity, so the packets are equal.
  const issued = buildStudioRoom
    ? await (async () => {
      const result = await buildStudioOwedRoutes({ itemId: binding.itemId, capsuleId: binding.workroomRef!.workroomId, authorAgentId: BUILD_STUDIO_ASSISTANT_AGENT_ID });
      return result.routed ? result.routes.map((route) => route.requestCoworker) : [];
    })()
    : await (async () => {
      const { resolveTerminalInitiativeRecovery } = await import("@/lib/backlog/initiative-readiness/terminal-recovery");
      const recovery = await resolveTerminalInitiativeRecovery({ decision, currentAgentId: context!.agentId ?? null,
        refusedWorkroomId: binding.workroomRef!.workroomId });
      return recovery.reviewerRoutes.filter((route) => route.independent).map((route) => route.requestCoworker);
    })();
  if (!issued.some((issuedPacket) => canonicalJson(issuedPacket) === canonicalJson(params))) {
    if (!options?.sourceOnly && await hasCompletedReview(params, userId, context)) return { bounded: true };
    return deny("The review request has changed or is no longer eligible. Refresh readiness to get the current request.");
  }
  return { bounded: true };
}
