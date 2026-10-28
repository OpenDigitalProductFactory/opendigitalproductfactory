import { prisma } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { InitiativeReadinessDecision, ReadinessRequirementResult } from "@/lib/backlog/initiative-readiness";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { expandGrants } from "@/lib/tak/agent-grants";
import { INITIATIVE_READINESS_LANES, readinessLaneForRole } from "@/lib/tak/initiative-readiness-tool-grants";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthExecutionAuthority } from "@/lib/auth/oauth-tokens";
import { resolveAgentWorkroomAccess, resolveHumanWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { resolveMcpTaskAuthorityKey } from "@/lib/auth/oauth-task-authority";
import { deterministicExternalTaskRunId, remoteTaskRequestMatches } from "@/lib/mcp-task-capacity-contract";
import { loadTaskInitiativeReviewOutcome } from "@/lib/mcp-task-review-outcome";
import { BUILD_STUDIO_ASSISTANT_AGENT_ID, buildStudioOwedRoutes } from "@/lib/backlog/initiative-readiness/build-studio-owed-routes";
import { reviewDocumentPreflight } from "@/lib/mcp-task-review-document";
import { isCurrentDeliveredBodyAuthor } from "@/lib/backlog/initiative-readiness/body-baseline-author-room";
import { isFullSourceCommitSha } from "@/lib/work-capsules/work-capsule-branch-identity";

/** A delivery room in one of these states is retired: its work is over. */
const RETIRED_ROOM_STATUSES: ReadonlySet<string> = new Set(["archived", "complete"]);

/** Match the durable request identity, never a caller's task-handle assertion. */
async function matchingReviewRequest(params: Record<string, unknown>, userId: string, context: ToolExecutionContext) {
  const binding = parseInitiativeReviewBinding(params.initiativeReviewBinding);
  const keys = ["targetAgent", "objective", "questionPacketSummary", "requestKey", "tier", "enteredVia", "requiredToolNames", "initiativeReviewBinding"];
  if (!binding || Object.keys(params).some((key) => !keys.includes(key)) || params.tier !== 2 || params.enteredVia !== "handoff"
    || typeof params.targetAgent !== "string" || typeof params.objective !== "string"
    || typeof params.questionPacketSummary !== "string" || typeof params.requestKey !== "string"
    || !Array.isArray(params.requiredToolNames) || params.requiredToolNames.some((name) => typeof name !== "string")) return null;
  const authorityKey = await resolveMcpTaskAuthorityKey({ tokenId: context.apiTokenId!, userId, source: "oauth" });
  if (!authorityKey) return null;
  const taskRunId = deterministicExternalTaskRunId(authorityKey, params.requestKey);
  const task = await prisma.taskRun.findFirst({ where: { taskRunId, userId }, select: { a2aMetadata: true } });
  const names = [...new Set(params.requiredToolNames as string[])];
  const scope = [...(context.tokenGrantScopes ?? []).filter((entry) => !entry.startsWith("tool:") && !entry.startsWith("backlog-item:")),
    `backlog-item:${binding.itemId}`, ...names.map((name) => `tool:${name}`)];
  return task && remoteTaskRequestMatches(task.a2aMetadata, {
    agentId: params.targetAgent, routeContext: "/build", title: params.questionPacketSummary,
    objective: params.objective, prompt: params.objective, idempotencyKey: params.requestKey,
    riskClass: "bounded-write", authorityScope: scope, collaborationKind: "handoff", initiativeReviewBinding: binding,
  }) ? { taskRunId, binding } : null;
}

async function hasCompletedReview(params: Record<string, unknown>, userId: string, context: ToolExecutionContext) {
  // A finished review disappears from readiness. A replay may retrieve its
  // writer receipt, but a stale proposal cannot start another execution.
  const request = await matchingReviewRequest(params, userId, context);
  return Boolean(request && await loadTaskInitiativeReviewOutcome(request.taskRunId, request.binding));
}

/** `notice` is plain-words advice for the author; it never blocks (BI-4592CF69). */
type RequestAuthority = { bounded: boolean; refusal?: ToolResult; notice?: string };
const deny = (message: string): RequestAuthority => ({ bounded: true, refusal: {
  success: false, error: "independent_review_request_denied", message,
  data: { action: "For design, architecture or plan review, refresh claim_backlog_item_for_work on the exact Workroom with workIntent plan or implementation and submit recovery.reviewerRoutes[].requestCoworker unchanged. For terminal review, read get_backlog_item recovery. If the request was not delivered in a large response, use get_backlog_item with itemId and recoveryGate for one exact bounded request or explicit recovery. Workroom access must already be authorized." },
} });

/** An evidence author may request an independent review, never impersonate its writer.
 * The general collaboration lane is unchanged. The additional lane must match a
 * currently server-issued packet and stays on the token-bound task service even
 * when a portal thread happens to be present in the execution context. */
export async function authorizeCoworkerRequest(
  params: Record<string, unknown>, userId: string, context?: ToolExecutionContext,
  options?: { sourceOnly?: boolean; forceBounded?: boolean },
): Promise<RequestAuthority> {
  const recoveryTarget = params.reviewRecovery;
  // BI-817556D8: a personal access token has no acting coworker, so it can never
  // pass this guard. Say which connection can, instead of only what is missing.
  if (!context?.agentId) {
    return deny("A current acting coworker is required. Coworker and independent-review requests need an OAuth "
      + "connection bound to a coworker admitted to the item's Workroom; a personal access token cannot make them.");
  }
  if (params.reviewRecovery !== undefined) {
    const { parseReviewTaskRecoveryTarget } = await import("@/lib/mcp-task-submit-params");
    if (!parseReviewTaskRecoveryTarget(params.reviewRecovery)) return deny("The original review recovery target is malformed.");
    const { reviewRecovery: _transport, ...request } = params;
    params = request;
  }
  // Read live grants: a cached registry fallback cannot keep revoked delegation alive.
  const agent = await prisma.agent.findUnique({ where: { agentId: context.agentId },
    select: { status: true, archived: true, toolGrants: { select: { grantKey: true } } } });
  if (!agent || agent.status !== "active" || agent.archived) return deny("The acting coworker is not active.");
  const grants = expandGrants(agent.toolGrants.map((grant) => grant.grantKey));
  const scopes = expandGrants(context.tokenGrantScopes ?? []);
  if (!options?.sourceOnly && !options?.forceBounded && recoveryTarget === undefined && params.initiativeReviewBinding === undefined && grants.includes("thread_write") && (!context.apiTokenId || scopes.includes("thread_write"))) {
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
  if (binding?.presentReassessment && recoveryTarget !== undefined) {
    return deny("A present assessment cannot resume an original review. Use its exact issued request for readback.");
  }
  const lane = binding?.gate === "objective-mapping" && binding.writerToolName === "record_initiative_evidence"
    ? readinessLaneForRole("acceptance-reviewer")?.lane
    : binding && INITIATIVE_READINESS_LANES[binding.writerToolName];
  if (options?.sourceOnly && (!binding || binding.presentReassessment || binding.eligibleEvidenceActivityIds?.length
    || !["record_initiative_design_review", "record_initiative_architecture_review"].includes(binding.writerToolName))) {
    return deny("This review does not have a source-only activity contract.");
  }
  if (!binding?.workroomRef || !lane?.independent || (binding.gate !== "objective-mapping" && !lane.gates.some((gate) => gate === binding.gate))
    || params.targetAgent === context.agentId) return deny("Use an independent review request supplied by the item's readiness check.");
  const human = await currentUserContext(userId);
  if (!human || !can(human, "manage_backlog") || !can(human, lane.capability)) {
    return deny("Your current permissions do not authorize this review operation.");
  }
  // A Build Studio room records the item's ROW id in backlogItemId (the
  // attachment writes backlogItem.id); an adopted room records the BI- id.
  const bodyAcceptance = binding.gate === "objective-mapping" && binding.artifactRef.kind === "document-version";
  const roomSelect = { id: true, backlogItemId: true, executorKind: true, requestedByPrincipalId: true, status: true,
    repositoryFullName: true, headBranch: true, baseSha: true, headSha: true,
    featureBuild: { select: { createdById: true } } } as const;
  let room = await prisma.workroom.findFirst({ where: { capsuleId: binding.workroomRef.workroomId, archivedAt: null,
      ...(bodyAcceptance ? { status: { not: "archived" } } : {}) },
    select: roomSelect });
  if (!room && bodyAcceptance) {
    const subject = await prisma.backlogItem.findUnique({ where: { itemId: binding.itemId }, select: { id: true } });
    if (subject && await isCurrentDeliveredBodyAuthor(prisma, { ...subject, itemId: binding.itemId }, binding.workroomRef)) {
      room = await prisma.workroom.findFirst({ where: { capsuleId: binding.workroomRef.workroomId, status: "archived" },
        select: roomSelect });
    }
  }
  // BI-CE661173: a merged repair's review is anchored to its delivery room,
  // which is normally archived by then. Reading it here authorizes nothing: the
  // request proceeds only if the readiness issuer below re-issues this exact
  // packet, and it issues a retired anchor only for a repair the trunk proves
  // merged, to a reviewer outside every delivery actor.
  let headlessPirAnchor = false;
  let retiredPirAnchor = false;
  const pirRequest = binding.gate === "post-implementation-review"
    && binding.writerToolName === "record_initiative_post_implementation_review";
  if (!room && pirRequest) {
    room = await prisma.workroom.findFirst({ where: { capsuleId: binding.workroomRef.workroomId,
      status: { notIn: ["abandoned", "superseded"] } }, select: roomSelect });
    retiredPirAnchor = Boolean(room);
  } else if (room && pirRequest && RETIRED_ROOM_STATUSES.has(room.status)) {
    // BI-AA47C672: delivery rooms are retired by status while archivedAt stays
    // null (every merged break-fix anchor on the live install, 2026-10-28), so
    // the live read above finds them. Such a room is the same retired anchor.
    retiredPirAnchor = true;
  }
  // BI-46E344FE: an anchor that never recorded its head carries the merged
  // head the issuer read from the trunk; the packet re-issue below proves it.
  headlessPirAnchor = retiredPirAnchor && room!.headSha === null;
  const roomOwnsItem = Boolean(room) && (room!.backlogItemId === binding.itemId
    || (room!.backlogItemId !== null && room!.backlogItemId === (await prisma.backlogItem.findUnique({ where: { itemId: binding.itemId }, select: { id: true } }))?.id));
  const buildStudioRoom = roomOwnsItem && room!.executorKind === "build-studio";
  // BI-926A7E90 §4: a Build Studio room's assistant holds no connection, so its
  // review request travels on a live connection of the person who requested
  // the build. That person's identity, not the carrier's admission, is the
  // room check for such a room; every other check above still applies.
  const admitted = !roomOwnsItem ? false
    : buildStudioRoom
      // The person who requested the build: the room's requester when it has
      // one, else the build's creator (Build Studio attaches rooms with neither
      // principal set, but every build records who asked for it).
      ? room!.featureBuild?.createdById === userId
        || (room!.requestedByPrincipalId !== null && (await prisma.principalAlias.findFirst({
          where: { aliasType: "user", aliasValue: userId, issuer: "" }, select: { principalId: true } }))?.principalId === room!.requestedByPrincipalId!)
      : (await resolveAgentWorkroomAccess({ userId, agentId: context.agentId, workroomId: room!.id, requested: "action" })).decision.level === "action"
        // BI-D3BAF945: a person who opened a merged repair's room with no
        // assistant has the retired anchor's review carried on their own
        // connection. The person must be admitted; the carrying assistant only
        // transports the packet the issuer re-derives below, and the reviewer
        // is chosen apart from every delivery actor.
        || (retiredPirAnchor && (await resolveHumanWorkroomAccess({ userId, workroomId: room!.id, requested: "action" })).decision.level === "action");
  if (!admitted) {
    return deny(buildStudioRoom
      ? "Only a connection of the person who requested this Build Studio build may request its review."
      : "You and this coworker must both be admitted to the exact Workroom before requesting its review.");
  }
  // Reuse the canonical readiness projection and recovery issuer; client names,
  // hashes and packet-shaped JSON are never evidence of server authorization.
  const { getBacklogItem } = await import("./packs/backlog-pack-read-tools");
  let currentDesignSource;
  if (binding.artifactRef.kind === "repo-blob-at-commit" && !headlessPirAnchor) {
    if (!room || room.repositoryFullName !== binding.workroomRef.repositoryFullName
      || room.headBranch !== binding.workroomRef.branchName || room.headSha !== binding.workroomRef.headSha
      || !isFullSourceCommitSha(room.baseSha) || !isFullSourceCommitSha(room.headSha)) {
      return !options?.sourceOnly && await hasCompletedReview(params, userId, context)
        ? { bounded: true }
        : deny("The selected Workroom's immutable source changed or is incomplete. Refresh its exact claim and review request.");
    }
    currentDesignSource = { repositoryFullName: room.repositoryFullName, headBranch: room.headBranch,
      baseSha: room.baseSha, headSha: room.headSha };
  }
  const item = await getBacklogItem({ itemId: binding.itemId }, context.agentId, undefined, undefined,
    currentDesignSource ? { currentDesignSource } : undefined);
  if (options?.sourceOnly && item.data?.scopeKind !== "platform") {
    return deny("Source-only classification requires a platform-scoped review.");
  }
  const readiness = item.data?.readiness as { decisions?: Partial<Record<"plan" | "implementation" | "completion", InitiativeReadinessDecision>>;
    planBaselinePrerequisite?: ReadinessRequirementResult | null } | undefined;
  if (!item.success || !readiness?.decisions) return deny("This item's readiness could not be resolved.");
  // A Build Studio build's routes come from the same resolver the server
  // dispatcher uses, with the same author identity, so the packets are equal.
  // BI-27519C1A: that resolver also decides what the build owes. It prefers
  // the build's own plan gate decision, which can owe a plan review the item
  // projection below does not see (a plan that raised the build's shape), so
  // pendency is the issuer's, never the projection's: ~100 plan rooms were
  // refused "no pending review" on every dispatch until this.
  const buildStudioIssued = buildStudioRoom
    ? await (async () => {
      const result = await buildStudioOwedRoutes({ itemId: binding.itemId, capsuleId: binding.workroomRef!.workroomId, authorAgentId: BUILD_STUDIO_ASSISTANT_AGENT_ID });
      return result.routed ? result.routes.map((route) => route.requestCoworker) : [];
    })()
    : null;
  if (buildStudioIssued?.length === 0) return !options?.sourceOnly && await hasCompletedReview(params, userId, context)
    ? { bounded: true } : deny("This item has no pending review for the requested lane.");
  const { decisionForIndependentReview } = await import("@/lib/backlog/initiative-readiness/design-phase-recovery");
  const decision = buildStudioIssued ? null
    : decisionForIndependentReview(binding.writerToolName, readiness.decisions, readiness.planBaselinePrerequisite);
  if (!buildStudioIssued && !decision) return !options?.sourceOnly && await hasCompletedReview(params, userId, context)
    ? { bounded: true } : deny("This item has no pending review for the requested lane.");
  if (decision?.verdict === "allowed") return !options?.sourceOnly && await hasCompletedReview(params, userId, context)
    ? { bounded: true } : deny("This item has no pending independent completion review.");
  const issued = buildStudioIssued
    ?? await (async () => {
      const { resolveTerminalInitiativeRecovery } = await import("@/lib/backlog/initiative-readiness/terminal-recovery");
      const recovery = await resolveTerminalInitiativeRecovery({ decision: decision!, currentAgentId: context!.agentId ?? null, currentUserId: userId,
        refusedWorkroomId: binding.workroomRef!.workroomId,
        taskAuthority: ["design-spec", "spec-approval", "architecture-review", "plan-review"].includes(binding.gate) ? await (async () => {
          const taskAuthorityKey = await resolveMcpTaskAuthorityKey({ tokenId: context.apiTokenId!, userId, source: "oauth" });
          return taskAuthorityKey ? { userId, taskAuthorityKey } : null;
        })() : null });
      return recovery.reviewerRoutes.filter((route) => route.independent).map((route) => route.requestCoworker);
    })();
  const comparable = binding.presentReassessment ? await (async () => {
    if (recoveryTarget !== undefined) return [];
    const { issuePresentReassessmentRequest } = await import("@/lib/mcp-task-review-reassessment");
    const packets: Record<string, unknown>[] = [];
    for (const packet of issued) {
      try { packets.push(await issuePresentReassessmentRequest({ packet, authorizationItemId: binding.presentReassessment!.authorizationItemId,
        userId, actingAgentId: context.agentId!, tokenGrantScopes: context.tokenGrantScopes ?? [] })); }
      catch { /* An unproven source does not issue an alternative packet. */ }
    }
    return packets;
  })() : issued;
  if (!comparable.some((issuedPacket) => canonicalJson(issuedPacket) === canonicalJson(params))) {
    if (!options?.sourceOnly && await hasCompletedReview(params, userId, context)) return { bounded: true };
    return deny("The review request has changed or is no longer eligible. This refusal does not deliver a replacement packet. Read get_backlog_item with itemId and recoveryGate for the current exact request or explicit recovery; never reconstruct it.");
  }
  // The native door must retain an issued original-task locator. Dropping it
  // cannot turn a recovery request into a new connection's duplicate task.
  if (!binding.presentReassessment && !options?.sourceOnly && !options?.forceBounded) {
    const { issueOriginalReviewRecoveryTarget } = await import("@/lib/mcp-task-review-recovery");
    const key = await resolveMcpTaskAuthorityKey({ tokenId: context.apiTokenId, userId, source: "oauth" });
    if (!key) return deny("The current connection's review task authority is unavailable.");
    const recovery = await issueOriginalReviewRecoveryTarget({ packet: params, userId, actingAgentId: context.agentId, taskAuthorityKey: key });
    if (recovery.kind === "refused" || (recovery.kind === "target"
      ? canonicalJson(recovery.target) !== canonicalJson(recoveryTarget)
      : recoveryTarget !== undefined)) return deny("Refresh the exact original-task recovery packet with get_backlog_item and recoveryGate; the prior review must not be duplicated.");
  }
  // Read protected bytes only after consent, grants, room access and exact
  // issuance are established. Existing requests join their recorded work;
  // neither a provider outage nor a new parser can erase historical evidence.
  if (!options?.sourceOnly && binding.writerToolName === "record_initiative_design_review"
    && (binding.gate === "spec-approval" || binding.gate === "design-spec")
    && !await matchingReviewRequest(params, userId, context)) {
    const { refusal: documentRefusal, notice } = await reviewDocumentPreflight(binding);
    if (documentRefusal) return { bounded: true, refusal: { success: false,
      error: documentRefusal.error, message: documentRefusal.message,
      data: { gateStatus: documentRefusal.gateStatus,
        action: "Correct the scope document and refresh its immutable review request, or retry the same request after source access is restored." },
    } };
    if (notice) return { bounded: true, notice };
  }
  return { bounded: true };
}
