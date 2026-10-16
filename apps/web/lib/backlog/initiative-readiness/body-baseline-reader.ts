import { prisma } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { parseInitiativeReviewBinding, immutableArtifactIdentity, validateInitiativeReviewAuthorityScope } from "@/lib/mcp-task-review-contract";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { isRecord } from "@/lib/shared/coerce";
import { pageSource } from "@/lib/source-page";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { bodyBaselineDigest } from "./body-baseline-version";
import { bodyBaselineInputsMatch } from "./body-baseline-binding";
import { currentBaseline, parseBaselinePayloads } from "./terminal-recovery";
import { loadBaselineSourceForItem, type BaselineSourceDb } from "./baseline-source";
import { isArchivedBodyAuthorRoom, isCurrentDeliveredBodyAuthor } from "./body-baseline-author-room";

/** This reader is an exact acceptance TaskRun reader, never a general document lookup. */
export async function readInitiativeBodyVersion(params: Record<string, unknown>, userId: string,
  context?: ToolExecutionContext): Promise<ToolResult> {
  const refuse = (error: string): ToolResult => ({ success: false, error,
    message: "The retained criteria no longer match this exact independent acceptance request. Refresh completion recovery." });
  if (!context?.taskRunId || !context.agentId) return refuse("immutable_review_binding_required");
  const human = await currentUserContext(userId);
  if (!human || !can(human, "manage_backlog")) return refuse("AUTHORIZATION_DENIED");
  const run = await prisma.taskRun.findUnique({ where: { taskRunId: context.taskRunId },
    select: { userId: true, currentAgentId: true, status: true, completedAt: true, archivedAt: true, authorityScope: true, a2aMetadata: true } });
  const binding = isRecord(run?.a2aMetadata) ? parseInitiativeReviewBinding(run.a2aMetadata.initiativeReviewBinding) : null;
  if (!run || run.userId !== userId || run.currentAgentId !== context.agentId
    || !["working", "input-required"].includes(run.status) || run.completedAt !== null || run.archivedAt !== null
    || binding?.gate !== "objective-mapping" || binding.artifactRef.kind !== "document-version") return refuse("immutable_review_binding_required");
  const scope = Array.isArray(run.authorityScope) && run.authorityScope.every((entry) => typeof entry === "string") ? run.authorityScope as string[] : null;
  if (!scope || validateInitiativeReviewAuthorityScope(binding, scope)) return refuse("AUTHORIZATION_DENIED");
  const identity = immutableArtifactIdentity(binding.artifactRef);
  if (Object.entries(identity).some(([key, value]) => params[key] !== value)) return refuse("immutable_blob_mismatch");
  const item = await prisma.backlogItem.findUnique({ where: { itemId: binding.itemId },
    select: { id: true, itemId: true, body: true, organizationId: true } });
  if (!item) return refuse("OBJECTIVE_BASELINE_CONFLICT");
  const source = await loadBaselineSourceForItem(prisma as unknown as BaselineSourceDb, item);
  const rows = parseBaselinePayloads(source.baselineRows.map((row) => row.payload));
  const baseline = rows && currentBaseline(rows);
  if (!baseline || !bodyBaselineInputsMatch(baseline, { ...item, binding })) return refuse("OBJECTIVE_BASELINE_CONFLICT");
  const room = binding.workroomRef && await prisma.workroom.findUnique({ where: { capsuleId: binding.workroomRef.workroomId },
    select: { id: true, backlogItemId: true, headSha: true, repositoryFullName: true, headBranch: true, archivedAt: true, status: true } });
  if (!room || (isArchivedBodyAuthorRoom(room) && !await isCurrentDeliveredBodyAuthor(prisma, item, binding.workroomRef!))
    || ![item.id, item.itemId].includes(room.backlogItemId ?? "")
    || room.headSha !== binding.workroomRef!.headSha || room.headBranch !== binding.workroomRef!.branchName
    || room.repositoryFullName !== binding.workroomRef!.repositoryFullName) return refuse("OBJECTIVE_BASELINE_CONFLICT");
  if ((await resolveAgentWorkroomAccess({ userId, agentId: context.agentId, workroomId: room.id, requested: "content" })).decision.level !== "content") {
    return { success: false, error: "workroom_access_denied", message: "The reviewer or delegating person no longer has access to this Workroom. Resolve admission through the existing governed coworker engagement procedure before resuming this exact request." };
  }
  const version = await prisma.documentVersion.findUnique({ where: { id: binding.artifactRef.versionId },
    select: { contentText: true, contentSha256: true, document: { select: { externalLocator: true, organizationId: true } } } });
  const locator = isRecord(version?.document.externalLocator) ? version.document.externalLocator : null;
  const subject = isRecord(locator?.subject) ? locator.subject : null;
  if (!version?.contentText || version.document.organizationId !== baseline.storageOrganizationId
    || (item.organizationId !== null && version.document.organizationId !== item.organizationId)
    || version.contentSha256 !== binding.artifactRef.valueDigest
    || bodyBaselineDigest(version.contentText) !== binding.artifactRef.valueDigest
    || locator?.origin !== "item-body" || subject?.kind !== "backlog-item" || subject.id !== item.itemId) return refuse("immutable_blob_mismatch");
  const page = pageSource({ content: version.contentText, ref: identity.version, path: identity.path,
    blobId: identity.expectedBlobId, cursor: params.cursor, startLine: params.startLine,
    maxLines: params.maxLines, maxChars: params.maxChars });
  if ("error" in page) return { success: false, error: page.error, message: page.error };
  return { success: true, message: `Read retained acceptance criteria for ${item.itemId}.`, data: { ...page, repositoryFullName: identity.repositoryFullName } };
}
