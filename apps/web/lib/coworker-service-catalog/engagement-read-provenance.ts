import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { SOURCE_READ_MAX_CHARS, sourcePageEndLine } from "@/lib/source-page-lines";
import type { ToolResult } from "@/lib/mcp-tool-types";
import type { EngagementTaskBinding } from "./engagement-task-binding";
import { parseEngagementTaskBinding, engagementProviderIdentityRefs } from "./engagement-task-binding";
import { captureTaskExecutionFence, sameTaskExecutionFence, type TaskExecutionFence } from "@/lib/shared/task-execution-fence";
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export type EngagementRead = { executionId: string; kind: "source" | "corpus" | "calibration"; [key: string]: unknown };
type Artifact = EngagementTaskBinding["artifactRef"];
/** Compact evidence of the exact returned bytes; audit payload suppression is unchanged. */
export function compactEngagementRead(executionId: string, name: string, args: Record<string, unknown>, result: ToolResult): EngagementRead | null {
  if (!result.success) return null;
  const data = record(result.data);
  if (name === "read_source_at_version") {
    if (data.repositoryFullName !== args.repositoryFullName || data.version !== args.version || data.path !== args.path || data.blobId !== args.expectedBlobId
      || typeof data.content !== "string" || data.content.length > SOURCE_READ_MAX_CHARS || typeof data.hasMore !== "boolean"
      || ![data.startLine, data.endLine, data.totalLines].every(v => Number.isSafeInteger(v) && Number(v) > 0)
      || sourcePageEndLine(Number(data.startLine), data.content) !== data.endLine
      || Number(data.endLine) < Number(data.startLine) || Number(data.endLine) > Number(data.totalLines)
      || (data.hasMore ? typeof data.nextCursor !== "string" || !data.nextCursor : data.nextCursor !== null)) return null;
    return { executionId, kind: "source", repositoryFullName: data.repositoryFullName, version: data.version, path: data.path, blobId: data.blobId,
      startLine: data.startLine, endLine: data.endLine, totalLines: data.totalLines, hasMore: data.hasMore, nextCursor: data.nextCursor,
      requestCursor: args.cursor ?? null, requestedStartLine: args.startLine ?? 1,
      contentSha256: hash(data.content), contentChars: data.content.length, endsWithNewline: data.content.endsWith("\n"), completePage: true };
  }
  if (name === "wiki_query" && Array.isArray(data.results)) {
    const pages = data.results.flatMap(value => { const page = record(value); const preview = page.contentPreview;
      return typeof page.slug === "string" && page.slug.startsWith("professions/") && typeof preview === "string"
        ? [{ slug: page.slug, pageId: page.pageId ?? null, coverage: "preview", contentSha256: hash(preview), contentChars: preview.length }] : []; });
    return { executionId, kind: "corpus", pages };
  }
  if (name === "search_ux_critique_corpus" && args.calibratedOnly === true && Number.isSafeInteger(data.total) && Number(data.total) >= 0 && typeof data.grounding === "string")
    return { executionId, kind: "calibration", total: data.total, grounding: data.grounding, calibratedOnly: true };
  return null;
}
export function completeArtifactReads(artifact: Artifact, evidence: readonly EngagementRead[]): boolean {
  const pages = evidence.filter(e => e.kind === "source" && e.repositoryFullName === artifact.repositoryFullName && e.version === artifact.commitSha && e.path === artifact.path && e.blobId === artifact.providerBlobId);
  let prior: EngagementRead | null = null;
  for (const page of pages) {
    if (page.startLine === 1 && page.requestCursor === null && page.requestedStartLine === 1) prior = null;
    if (!prior && (page.startLine !== 1 || page.requestCursor !== null || page.requestedStartLine !== 1)) continue;
    if (prior && (!prior.hasMore || page.requestCursor !== prior.nextCursor || page.totalLines !== prior.totalLines
      || page.startLine !== Number(prior.endLine) + (prior.endsWithNewline ? 1 : 0))) return false;
    if (page.completePage !== true || typeof page.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(page.contentSha256)) return false;
    if (page.hasMore === false) return page.endLine === page.totalLines;
    prior = page;
  }
  return false;
}
export function engagementReadBudget(evidence: readonly EngagementRead[]): string | null {
  if (evidence.length > 100) return "read-count-exceeded";
  const source = evidence.filter(e => e.kind === "source");
  if (source.length > 50 || source.reduce((sum, e) => sum + Number(e.contentChars ?? 0), 0) > 512_000) return "source-budget-exceeded";
  if (evidence.reduce((sum, e) => sum + (Array.isArray(e.pages) ? e.pages.length : 0), 0) > 32) return "corpus-reference-budget-exceeded";
  if (Buffer.byteLength(canonicalJson(evidence), "utf8") > 128_000) return "provenance-bytes-exceeded";
  return null;
}
/** Called by the shared governed boundary for native and loop tool calls. */
export async function persistEngagementRead(input: { taskRunId: string; userId: string; agentId: string; executionId: string; toolName: string; args: Record<string, unknown>; result: ToolResult; fence: TaskExecutionFence | null | undefined }) {
  const { prisma } = await import("@dpf/db");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${input.taskRunId} FOR UPDATE`;
    const task = await tx.taskRun.findUnique({ where: { taskRunId: input.taskRunId } });
    const metadata = record(task?.a2aMetadata), binding = parseEngagementTaskBinding(metadata.engagementBinding);
    if (!binding) return;
    if (!task || task.status !== "working" || input.userId !== binding.userId || !engagementProviderIdentityRefs(binding.providerAgentId).includes(input.agentId)
      || !sameTaskExecutionFence(input.fence, captureTaskExecutionFence(task.progressPayload, metadata.requestDigest))) throw new Error("engagement_read_execution_displaced");
    const evidence = compactEngagementRead(input.executionId, input.toolName, input.args, input.result);
    if (!evidence) return;
    const prior = Array.isArray(metadata.engagementReadEvidence) ? metadata.engagementReadEvidence : [];
    if (prior.some(value => record(value).executionId === input.executionId)) return;
    const next = [...prior, { ...evidence, observedAt: new Date().toISOString(), agentId: input.agentId, fence: input.fence }];
    const exceeded = engagementReadBudget(engagementReadEvidence(next));
    if (exceeded) {
      await tx.taskRun.update({ where: { id: task.id }, data: { a2aMetadata: { ...metadata, engagementReadFailure: { code: "engagement_read_budget_exceeded", reason: exceeded, executionId: input.executionId } } as never } });
      return;
    }
    await tx.taskRun.update({ where: { id: task.id }, data: { a2aMetadata: { ...metadata, engagementReadEvidence: next } as never } });
  });
}
export function engagementReadEvidence(value: unknown): EngagementRead[] {
  return Array.isArray(value) ? value.filter(v => typeof record(v).executionId === "string" && ["source", "corpus", "calibration"].includes(String(record(v).kind))) as EngagementRead[] : [];
}
