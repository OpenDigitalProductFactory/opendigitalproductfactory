import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { Prisma } from "@dpf/db";
import type { RemoteTaskSubmitAuth } from "@/lib/mcp-task-submit-types";
import { parseEngagementTaskBinding, engagementInputDigest, buildEngagementTaskPrompt, engagementProviderIdentityRefs, ENGAGEMENT_READ_TOOLS, type EngagementTaskBinding } from "./engagement-task-binding";
export { parseEngagementTaskBinding, engagementInputDigest, buildEngagementTaskPrompt, engagementProviderIdentityRefs, ENGAGEMENT_READ_TOOLS, type EngagementTaskBinding } from "./engagement-task-binding";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value === value.trim();
type Offer = { offerId: string; serviceId: string; status: string; authorityBoundary: string; riskTier: string; availabilityScope: string; budgetEnvelope: unknown; requiredApprovals: unknown; expiresAt: Date | null };
type Service = { serviceId: string; providerAgentId: string; status: string; authorityBoundary: string; riskTier: string; availabilityScope: string };
type Engagement = { engagementId: string; offerId: string; serviceId: string; providerAgentId: string; requestedByUserId: string | null; requestedByAgentId: string | null; requestedOutcome: string; inputPayload: unknown; status: string; approvalContext: unknown; metadata: unknown };
type Room = { capsuleId: string; repositoryFullName: string | null; headSha: string | null; archivedAt: Date | null; workspaceState: unknown };
export function assertEngagementSnapshot(binding: EngagementTaskBinding, state: { engagement: Engagement; offer: Offer; service: Service; room: Room }, taskRunId?: string): void {
  const { engagement, offer, service, room } = state;
  const reject = () => { throw new Error("engagement_binding_refused: current request, offer, authority or immutable scope no longer matches"); };
  if (!parseEngagementTaskBinding(binding)
    || engagement.engagementId !== binding.engagementId || engagement.offerId !== binding.offerId
    || engagement.serviceId !== binding.serviceId || engagement.providerAgentId !== binding.providerAgentId
    || engagement.requestedByUserId !== binding.userId || engagement.requestedByAgentId !== binding.actorAgentId
    || engagementInputDigest(engagement.requestedOutcome, engagement.inputPayload) !== binding.inputDigest
    || !["requested", "accepted", "in-progress"].includes(engagement.status)
    || record(engagement.approvalContext).required !== false
    || offer.offerId !== binding.offerId || offer.serviceId !== binding.serviceId
    || service.serviceId !== binding.serviceId || service.providerAgentId !== binding.providerAgentId
    || [offer, service].some(row => row.status !== "active" || !["advice-only", "proposal-only"].includes(row.authorityBoundary)
      || !["low", "medium"].includes(row.riskTier) || row.availabilityScope !== "internal")
    || (offer.expiresAt !== null && offer.expiresAt <= new Date())
    || !Array.isArray(offer.requiredApprovals) || offer.requiredApprovals.length > 0
    || record(offer.budgetEnvelope).paidProvider === true || record(offer.budgetEnvelope).requiresBudgetApproval === true
    || room.capsuleId !== binding.workroomId || room.archivedAt !== null
    || room.repositoryFullName !== binding.artifactRef.repositoryFullName || room.headSha !== binding.artifactRef.commitSha
    || record(record(room.workspaceState).workroomDrive).stageKey !== binding.stageKey) reject();
  const fulfillment = record(engagement.metadata).fulfillment;
  if (fulfillment !== undefined && (!taskRunId || record(fulfillment).taskRunId !== taskRunId
    || canonicalJson(record(fulfillment).binding) !== canonicalJson(binding))) reject();
}

/** Checked again in governed dispatch, including native/deferred tool calls. */
export function engagementToolAllowed(binding: EngagementTaskBinding, toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === "wiki_query" || toolName === "search_ux_critique_corpus") return true;
  const artifact = binding.artifactRef;
  return toolName === "read_source_at_version" && args.repositoryFullName === artifact.repositoryFullName
    && args.version === artifact.commitSha && args.path === artifact.path && args.expectedBlobId === artifact.providerBlobId;
}

/** Revalidated at admission, replay, execution and every governed tool call. */
export async function validateEngagementTask(input: {
  binding: EngagementTaskBinding; token: RemoteTaskSubmitAuth; authorityScope: readonly string[];
  taskRunId: string; db?: Prisma.TransactionClient; requireAssociation?: boolean;
  request?: { objective: string; prompt: string };
}) {
  const { prisma } = await import("@dpf/db");
  const db = input.db ?? prisma;
  const { binding, token } = input;
  const { isCurrentOAuthExecutionAuthority, OAUTH_EXECUTION_AUTHORITY_SELECT } = await import("@/lib/auth/oauth-tokens");
  const { expandGrants, persistedAgentToolGrants } = await import("@/lib/tak/agent-grants");
  const { resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
  if ((token.source !== "oauth" && token.source !== "pat") || token.capability !== "write") throw new Error("engagement_requires_verified_write_token");
  const credential = await db.mcpApiToken.findUnique({ where: { id: token.tokenId }, select: {
    ...OAUTH_EXECUTION_AUTHORITY_SELECT, scopes: true, capability: true, workroomRef: true, runRef: true,
  } });
  if (!credential || credential.capability !== "write" || credential.userId !== token.userId || token.userId !== binding.userId || !credential.agentId
    || credential.revokedAt || (token.source === "oauth"
      ? !await isCurrentOAuthExecutionAuthority(credential, db)
      : credential.kind === "oauth_access" || (credential.expiresAt !== null && credential.expiresAt <= new Date()))) throw new Error("engagement_authorization_revoked");
  const [actor, provider, engagement, room] = await Promise.all([
    db.agent.findFirst({ where: { OR: [{ id: credential.agentId }, { agentId: credential.agentId }, { slugId: credential.agentId }], status: "active", archived: false }, include: { toolGrants: true, toolGrantRevocations: true } }),
    db.agent.findUnique({ where: { agentId: binding.providerAgentId }, include: { toolGrants: true, toolGrantRevocations: true } }),
    db.coworkerEngagement.findUnique({ where: { engagementId: binding.engagementId }, include: { offer: true, service: true } }),
    db.workroom.findUnique({ where: { capsuleId: binding.workroomId } }),
  ]);
  if (!actor || actor.agentId !== binding.actorAgentId || !provider || provider.status !== "active" || provider.archived
    || !engagement || !room) throw new Error("engagement_principal_or_scope_unavailable");
  const providerRefs = engagementProviderIdentityRefs(binding.providerAgentId);
  const counterpartId = providerRefs.find(id => id !== provider.agentId);
  const counterpart = counterpartId ? await db.agent.findUnique({ where: { agentId: counterpartId }, include: { toolGrants: true, toolGrantRevocations: true } }) : provider;
  if (!counterpart || counterpart.status !== "active" || counterpart.archived
    || provider.lifecycleStage !== "production" || counterpart.lifecycleStage !== "production") throw new Error("engagement_provider_identity_pair_unavailable");
  if (!["operator", "oauth_access", "workroom_session"].includes(credential.kind)
    || (credential.kind === "workroom_session" && (credential.workroomRef !== room.capsuleId
      || credential.runRef !== room.taskRunId))) throw new Error("engagement_credential_scope_refused");
  const tokenGrants = expandGrants(credential.scopes);
  const actorGrants = expandGrants(persistedAgentToolGrants(actor));
  const providerGrants = expandGrants(persistedAgentToolGrants(provider));
  const counterpartGrants = expandGrants(persistedAgentToolGrants(counterpart));
  if (!tokenGrants.includes("coworker_engagement_write") || !actorGrants.includes("coworker_engagement_write")
    || ["file_read", "registry_read"].some(grant => !tokenGrants.includes(grant) || !actorGrants.includes(grant) || !providerGrants.includes(grant) || !counterpartGrants.includes(grant))
    || input.authorityScope.some(scope => scope.startsWith("tool:")
      ? !(ENGAGEMENT_READ_TOOLS as readonly string[]).includes(scope.slice(5))
      : !tokenGrants.includes(scope) || !actorGrants.includes(scope))
    || ENGAGEMENT_READ_TOOLS.some(name => !input.authorityScope.includes(`tool:${name}`))) throw new Error("engagement_grant_intersection_refused");
  assertEngagementSnapshot(binding, { engagement, offer: engagement.offer, service: engagement.service, room }, input.taskRunId);
  if (input.request && (input.request.objective !== engagement.requestedOutcome
    || input.request.prompt !== buildEngagementTaskPrompt(binding, engagement))) throw new Error("engagement_request_content_refused");
  if (input.requireAssociation && record(record(engagement.metadata).fulfillment).taskRunId !== input.taskRunId) throw new Error("engagement_execution_association_missing");
  for (const [agentId, requested] of [[actor.agentId, "action"], ...providerRefs.map(id => [id, "content"] as const)] as const) {
    const access = await resolveAgentWorkroomAccess({ userId: token.userId, agentId, workroomId: room.id, requested }, db);
    if (access.decision.level !== requested) throw new Error(`engagement_room_access_refused:${access.decision.reason}`);
  }
  return { engagement, room };
}

type ContributionExecution = { id: string; toolName: string; success: boolean; parameters: unknown; result: unknown };
export function validateEngagementContribution(binding: EngagementTaskBinding, content: unknown, executions: readonly ContributionExecution[], professionKey?: string) {
  if (typeof content !== "string" || content.length > 100_000) return null;
  let contribution: Record<string, unknown>;
  try { contribution = record(JSON.parse(content.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, ""))); } catch { return null; }
  const nonemptyStrings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(text);
  if (!text(contribution.summary) || !nonemptyStrings(contribution.criteria) || !nonemptyStrings(contribution.corpusRefs) || !Array.isArray(contribution.findings)) return null;
  const reads = executions.filter(row => row.success && row.toolName === "read_source_at_version" && engagementToolAllowed(binding, row.toolName, record(row.parameters)));
  const corpus = executions.filter(row => row.success && row.toolName === "wiki_query");
  const critiqueLookups = executions.filter(row => row.success && row.toolName === "search_ux_critique_corpus" && record(row.parameters).calibratedOnly === true);
  const slugs = new Set(corpus.flatMap(row => {
    const results = record(record(row.result).data).results;
    return Array.isArray(results) ? results.flatMap(page => text(record(page).slug) ? [String(record(page).slug)] : []) : [];
  }));
  if (!reads.length || (professionKey === "ux-design" && !critiqueLookups.length) || contribution.corpusRefs.some(slug => !slugs.has(slug)
    || !slug.startsWith(professionKey ? `professions/${professionKey}/` : "professions/"))) return null;
  return { ...contribution, sourceExecutionIds: reads.map(row => row.id), corpusExecutionIds: corpus.map(row => row.id),
    artifactRef: binding.artifactRef, actorAgentId: binding.actorAgentId, providerAgentId: binding.providerAgentId,
    engagementId: binding.engagementId, professionKey: professionKey ?? null,
    workroomId: binding.workroomId, stageKey: binding.stageKey, advisoryOnly: true, authorDisposition: "pending",
    critiqueCorpusEvidence: critiqueLookups.map(row => ({ executionId: row.id, grounding: record(record(row.result).data).grounding ?? "unknown", total: record(record(row.result).data).total ?? null })) };
}

/** Projection is repeatable from persisted task + tool evidence, including after worker interruption. */
export async function reconcileEngagementTaskResult(taskRunId: string, db?: Prisma.TransactionClient) {
  const prisma = db ?? (await import("@dpf/db")).prisma;
  const { hasExecutionUncertainty } = await import("@/lib/shared/execution-uncertainty");
  const task = await prisma.taskRun.findUnique({ where: { taskRunId }, select: { status: true, progressPayload: true, a2aMetadata: true, completedAt: true } });
  const binding = parseEngagementTaskBinding(record(task?.a2aMetadata).engagementBinding);
  if (!task || !binding) return;
  const engagement = await prisma.coworkerEngagement.findUnique({ where: { engagementId: binding.engagementId } });
  if (!engagement || !["accepted", "in-progress", "unknown"].includes(engagement.status)) return;
  const metadata = record(engagement.metadata), association = record(metadata.fulfillment);
  if (association.taskRunId !== taskRunId || canonicalJson(association.binding) !== canonicalJson(binding)) return;
  let status: string = "accepted";
  let result: ReturnType<typeof validateEngagementContribution> = null;
  if (hasExecutionUncertainty(task.progressPayload)) status = "unknown";
  else if (task.status === "canceled") status = "cancelled";
  else if (["failed", "rejected"].includes(task.status)) status = "failed";
  else if (task.status === "working") status = "in-progress";
  else if (task.status === "completed") {
    const room = await prisma.workroom.findUnique({ where: { capsuleId: binding.workroomId }, select: { repositoryFullName: true, headSha: true } });
    const executions = await prisma.toolExecution.findMany({ where: { taskRunId, agentId: { in: engagementProviderIdentityRefs(binding.providerAgentId) }, userId: binding.userId, success: true },
      select: { id: true, toolName: true, parameters: true, result: true, success: true } });
    const { findProfessionFamilyForAgentIdentity } = await import("@/lib/decision-perspective/resolve-profession-profile");
    const provider = await prisma.agent.findUnique({ where: { agentId: binding.providerAgentId }, select: { agentId: true, name: true, slugId: true } });
    const family = provider ? findProfessionFamilyForAgentIdentity(provider) : null;
    const currentRevision = room?.repositoryFullName === binding.artifactRef.repositoryFullName && room.headSha === binding.artifactRef.commitSha
      && engagementInputDigest(engagement.requestedOutcome, engagement.inputPayload) === binding.inputDigest;
    result = family && currentRevision ? validateEngagementContribution(binding, record(task.progressPayload).summary, executions, family.professionKey) : null;
    status = result ? "completed" : "unavailable";
  } else if (["input-required", "auth-required"].includes(task.status)) status = "unknown";
  if (status === engagement.status && !result) return;
  await prisma.coworkerEngagement.updateMany({ where: { id: engagement.id, updatedAt: engagement.updatedAt, status: engagement.status }, data: {
    status, completedAt: status === "completed" ? task.completedAt ?? new Date() : null,
    metadata: { ...metadata, fulfillment: { ...association, state: status, taskStatus: task.status,
      ...(status === "unavailable" ? { reason: "No verifiable specialist source/corpus contribution was produced." } : {}) },
      ...(result ? { result } : {}) } as Prisma.InputJsonValue,
  } });
}

/** Atomically associate the existing request with one durable TaskRun; a retry never substitutes a new run. */
export async function admitEngagementTask(input: Parameters<typeof validateEngagementTask>[0] & { db: Prisma.TransactionClient }) {
  const { engagement, room } = await validateEngagementTask(input);
  const prior = record(engagement.metadata).fulfillment;
  if (prior !== undefined) {
    const task = await input.db.taskRun.findUnique({ where: { taskRunId: input.taskRunId }, select: { a2aMetadata: true } });
    if (!task || canonicalJson(record(task.a2aMetadata).engagementBinding) !== canonicalJson(input.binding)) throw new Error("engagement_association_without_original_task");
    return;
  }
  const association = { version: 1, binding: input.binding, taskRunId: input.taskRunId, state: "accepted" };
  const written = await input.db.coworkerEngagement.updateMany({
    where: { id: engagement.id, updatedAt: engagement.updatedAt, status: engagement.status },
    data: { status: "accepted", acceptedAt: new Date(), workCapsuleId: room.capsuleId,
      metadata: { ...record(engagement.metadata), fulfillment: association } as Prisma.InputJsonValue },
  });
  if (written.count !== 1) throw new Error("engagement_admission_race_retry_original_request");
}
