import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthAccessToken } from "@/lib/auth/oauth-tokens";
import { resolveMcpTaskAuthorityKey } from "@/lib/auth/oauth-task-authority";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { deterministicExternalTaskRunId } from "@/lib/mcp-task-capacity-contract";
import { loadPersistedRemoteTask, reconstructPersistedRemoteTask } from "@/lib/mcp-task-persisted-request";
import { deterministicTaskRunId } from "@/lib/change-review/semantic-review-single-flight";
import { parseSemanticReviewRequest } from "@/lib/change-review/semantic-review-request";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { isRecord } from "@/lib/shared/coerce";
import type { DurableTaskRow } from "./tasks-lifecycle";

export type OwnedTaskRow = DurableTaskRow & { id: string };
export type OwnedTaskOriginKind = "external" | "native" | "initiative" | "durable";
// Canonical JSON deliberately treats Date as {}; normalize DB dates first so
// timestamp-only checkpoint or credential changes cannot disappear from a fence.
export const taskReadFingerprint = (value: unknown) => createHash("sha256")
  .update(canonicalJson(JSON.parse(JSON.stringify(value ?? null)))).digest("hex");
function sharedTaskCheckpoint(row: Pick<OwnedTaskRow, "id" | "taskRunId" | "userId" | "status" | "title" | "objective" | "progressPayload" | "a2aMetadata" | "updatedAt">) {
  return { id: row.id, taskRunId: row.taskRunId, userId: row.userId, status: row.status, title: row.title,
    objective: row.objective, progressPayload: row.progressPayload, a2aMetadata: row.a2aMetadata, updatedAt: row.updatedAt };
}
const tokenSelect = { ...OAUTH_EXECUTION_AUTHORITY_SELECT, scopes: true } as const;
export type TaskReadAuthority = NonNullable<Awaited<ReturnType<typeof currentTaskReadAuthority>>>;

/** A current bearer is required: queued-work continuity cannot authenticate a read. */
export async function currentTaskReadAuthority(userId: string, context?: ToolExecutionContext) {
  if (context?.authSource !== "oauth" || !context.apiTokenId || !context.agentId
    || !isToolAllowedByGrants("get_mcp_task", context.tokenGrantScopes ?? [])) return null;
  const token = await prisma.mcpApiToken.findUnique({ where: { id: context.apiTokenId }, select: tokenSelect });
  const agentId = resolveCanonicalAgentId(context.agentId);
  if (!token || !isCurrentOAuthAccessToken(token) || token.oauthClient?.registrationKind === "credentials"
    || token.userId !== userId || !token.agentId || resolveCanonicalAgentId(token.agentId) !== agentId
    || !token.authorityBindingId || !token.oauthFamilyKey
    || !isToolAllowedByGrants("get_mcp_task", token.scopes)
    || !isToolAllowedByGrants("get_mcp_task", await getAgentToolGrantsAsync(agentId))) return null;
  const human = await currentUserContext(userId);
  if (!human || !can(human, "view_platform")) return null;
  const key = await resolveMcpTaskAuthorityKey({ tokenId: context.apiTokenId, userId, source: "oauth" });
  if (key !== `oauth-family:${token.oauthFamilyKey}`) return null;
  return { userId, agentId, key, token, fingerprint: taskReadFingerprint({ token, agentId, key }) };
}

/** The old token identifies the submitter; its expiry/revocation is not current read authority. */
async function originTokenMatches(tokenId: unknown, current: TaskReadAuthority) {
  if (typeof tokenId !== "string" || !tokenId) return null;
  const origin = await prisma.mcpApiToken.findUnique({ where: { id: tokenId }, select: tokenSelect });
  if (!origin || origin.kind !== "oauth_access" || origin.userId !== current.userId || !origin.agentId
    || resolveCanonicalAgentId(origin.agentId) !== current.agentId
    || origin.oauthClient?.registrationKind === "credentials"
    || origin.oauthFamilyKey !== current.token.oauthFamilyKey || origin.authorityBindingId !== current.token.authorityBindingId
    || origin.oauthClientId !== current.token.oauthClientId || origin.resource !== current.token.resource) return null;
  return origin;
}

/** Exact existing origin proof only. No conversation lookup, enumeration or identity repair. */
export async function admitOwnedTaskOrigin(row: OwnedTaskRow, current: TaskReadAuthority): Promise<{
  kind: OwnedTaskOriginKind; fingerprint: string;
} | null> {
  if (row.userId !== current.userId || !isRecord(row.a2aMetadata)) return null;
  const metadata = row.a2aMetadata;
  // Canonical helpers choose by these discriminators. Mixed origin must refuse
  // before any protected origin artifact, recovery or receipt can be collected.
  if ((metadata.trigger === "external-mcp" && metadata.gateKind !== undefined)
    || (metadata.gateKind === "semantic-review" && metadata.trigger !== undefined)) return null;
  if (metadata.trigger === "external-mcp") {
    if (metadata.tokenSource !== "oauth" || metadata.taskAuthorityKey !== current.key
      || typeof metadata.idempotencyKey !== "string"
      || deterministicExternalTaskRunId(current.key, metadata.idempotencyKey) !== row.taskRunId) return null;
    const origin = await originTokenMatches(metadata.apiTokenId, current);
    if (!origin) return null;
    // This canonical loader reads only the exact task's first saved request and current human.
    const persisted = await loadPersistedRemoteTask(row.taskRunId);
    if (!persisted || taskReadFingerprint(sharedTaskCheckpoint(persisted)) !== taskReadFingerprint(sharedTaskCheckpoint(row))) return null;
    const request = reconstructPersistedRemoteTask(persisted);
    if (!request.ok || persisted.currentAgentId !== request.data.parsed.agentId) return null;
    return { kind: metadata.initiativeReviewBinding ? "initiative" : metadata.durableInference ? "durable" : "external",
      fingerprint: taskReadFingerprint({ origin, persisted }) };
  }
  if (metadata.gateKind !== "semantic-review") return null;
  const artifactId = `semantic-review-request:${row.taskRunId}`;
  const artifact = await prisma.taskArtifact.findUnique({ where: { artifactId },
    select: { id: true, artifactId: true, taskRunId: true, parts: true } });
  if (!artifact || artifact.artifactId !== artifactId || artifact.taskRunId !== row.id || !Array.isArray(artifact.parts)) return null;
  const first = artifact.parts[0];
  const packet = parseSemanticReviewRequest(isRecord(first) ? first.data : null);
  const progress = isRecord(row.progressPayload) && isRecord(row.progressPayload.semanticReview) ? row.progressPayload.semanticReview : null;
  if (!packet || packet.actor.authSource !== "oauth" || packet.input.surface !== "external"
    || packet.actor.userId !== current.userId || !packet.actor.agentId
    || resolveCanonicalAgentId(packet.actor.agentId) !== current.agentId
    || packet.gateKey !== metadata.gateKey || packet.input.identity.capsuleId !== metadata.capsuleId
    || packet.digest !== progress?.requestDigest || !Number.isSafeInteger(metadata.attempt) || Number(metadata.attempt) < 1
    || deterministicTaskRunId(packet.gateKey, Number(metadata.attempt)) !== row.taskRunId) return null;
  const origin = await originTokenMatches(packet.actor.apiTokenId, current);
  if (!origin) return null;
  const room = await prisma.workroom.findUnique({ where: { capsuleId: packet.input.identity.capsuleId },
    select: { id: true, capsuleId: true, repositoryFullName: true } });
  if (!room || room.capsuleId !== packet.input.identity.capsuleId || room.repositoryFullName !== packet.repository) return null;
  const access = await resolveAgentWorkroomAccess({ userId: current.userId, agentId: current.agentId,
    workroomId: room.id, requested: "content" });
  if (access.decision.level !== "content") return null;
  return { kind: "native", fingerprint: taskReadFingerprint({ artifact, origin, room, packetDigest: packet.digest }) };
}
