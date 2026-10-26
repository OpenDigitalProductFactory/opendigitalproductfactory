import { describe, expect, it } from "vitest";
import { reconstructPersistedRemoteTask } from "@/lib/mcp-task-background-worker";
import { remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { parseEngagementTaskBinding,buildEngagementTaskPrompt } from "./engagement-task-binding";
import { engagementInputDigest } from "./engagement-fulfillment";

export function fixture() {
  const binding = { version: 1, engagementId: "CE-ORIGINAL", offerId: "offer-ux", serviceId: "service-ux", providerAgentId: "ux-design-critic", actorAgentId: "AGT-EXT-CODEX", userId: "user-1", workroomId: "WC-ORIGINAL", stageKey: "design", inputDigest: engagementInputDigest("Review", {}), artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/design.html", providerBlobId: "b".repeat(40) } };
  const parsed = parseRemoteTaskSubmitParams({ agentId: binding.providerAgentId, routeContext: "/area/platform", title: "UX review", objective: "Review", prompt: "Review original inputs", riskClass: "read", idempotencyKey: "coworker-engagement:CE-ORIGINAL", authorityScope: ["file_read", "registry_read", "coworker_engagement_write", "tool:read_source_at_version", "tool:wiki_query", "tool:search_ux_critique_corpus"], engagementBinding: binding });
  if (typeof parsed === "string") throw new Error(parsed);
  const row = { id: "task-row-1", taskRunId: "TR-ORIGINAL", userId: "user-1", threadId: "thread-1", contextId: "thread-1", status: "submitted", updatedAt: new Date(), routeContext: parsed.routeContext, title: parsed.title, objective: parsed.objective, currentAgentId: parsed.agentId, authorityScope: [...parsed.authorityScope!], progressPayload: {}, a2aMetadata: { idempotencyKey: parsed.idempotencyKey, requestDigest: remoteTaskRequestDigest(parsed), requestDigestVersion: 2, requestObjective: parsed.objective, riskClass: parsed.riskClass, apiTokenId: "token-1", tokenSource: "pat", tokenCapability: "write", requestedAgentId: parsed.agentId, requestedThreadId: null, engagementBinding: binding }, messages: [{ parts: [{ type: "message", text: parsed.prompt }] }], user: { id: "user-1", isActive: true, isSuperuser: false, groups: [{ platformRole: { roleId: "developer" } }] } };
  return { parsed, row };
}

describe("durable engagement task reconstruction", () => {
  it("reconstructs the exact original provider, actor, room and artifact without dispatching", () => {
    const { row, parsed } = fixture();
    const reconstructed = reconstructPersistedRemoteTask(row);
    expect(reconstructed.ok).toBe(true);
    if (!reconstructed.ok) throw new Error(reconstructed.message);
    expect(reconstructed.data.parsed.engagementBinding).toEqual(parsed.engagementBinding);
    expect(reconstructed.data.run.taskRunId).toBe("TR-ORIGINAL");
  });
  it("survives PostgreSQL JSONB nested object key order without changing the admitted digest", () => {
    const { row, parsed } = fixture();
    const binding = { ...row.a2aMetadata.engagementBinding, roomHeadSha: "c".repeat(40), guidanceArtifacts: [
      { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "c".repeat(40), path: "docs/professions/ux-design/wiki/hierarchy.md", providerBlobId: "d".repeat(40) },
    ] };
    parsed.engagementBinding = parseEngagementTaskBinding(binding)!;
    row.a2aMetadata.requestDigest = remoteTaskRequestDigest(parsed);
    // JSONB orders object keys by byte length and then byte value, recursively.
    const jsonb = (value: unknown): unknown => Array.isArray(value) ? value.map(jsonb)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([key, item]) => [key, jsonb(item)])) : value;
    row.a2aMetadata.engagementBinding = jsonb(binding) as typeof binding;
    expect(JSON.stringify(row.a2aMetadata.engagementBinding)).not.toBe(JSON.stringify(parsed.engagementBinding));
    expect(reconstructPersistedRemoteTask(row)).toMatchObject({ ok: true });
    expect(row.a2aMetadata.requestDigest).toBe(remoteTaskRequestDigest(parsed));
  });
  it("rejects a changed revision instead of reconstructing a different request", () => {
    const { row } = fixture();
    row.a2aMetadata.engagementBinding.artifactRef.commitSha = "c".repeat(40);
    expect(reconstructPersistedRemoteTask(row)).toMatchObject({ ok: false, code: "request_digest_mismatch" });
  });
  it("refuses persisted widened tools even if their packet digest was recomputed", () => {
    const { row, parsed } = fixture();
    row.authorityScope.push("tool:execute_script");
    row.a2aMetadata.requestDigest = remoteTaskRequestDigest({ ...parsed, authorityScope: row.authorityScope });
    expect(reconstructPersistedRemoteTask(row)).toMatchObject({ ok: false, code: "persisted_request_invalid" });
  });
});

it("normalizes optional visual refs across JSONB order without altering old bindings",()=>{
 const {parsed}=fixture();const old=remoteTaskRequestDigest(parsed);
 const visualEvidenceRef={kind:"document-version" as const,repositoryFullName:"owner/repo",versionId:"capture-manifest",valueDigest:"e".repeat(64)};
 const bound=parseEngagementTaskBinding({...parsed.engagementBinding,visualEvidenceRef})!;
 expect(bound.visualEvidenceRef).toEqual(visualEvidenceRef);
 expect(parseEngagementTaskBinding({...bound,visualEvidenceRef:{valueDigest:visualEvidenceRef.valueDigest,versionId:visualEvidenceRef.versionId,repositoryFullName:visualEvidenceRef.repositoryFullName,kind:visualEvidenceRef.kind}})).toEqual(bound);
 expect(remoteTaskRequestDigest({...parsed,engagementBinding:bound})).not.toBe(old);
 expect(remoteTaskRequestDigest(parsed)).toBe(old);
 expect(parseEngagementTaskBinding({...bound,visualEvidenceRef:{...visualEvidenceRef,repositoryFullName:"foreign/repo"}})).toBeNull();
});

it("keeps the legacy admitted prompt byte-for-byte at the optional image boundary",()=>{
 const {parsed}=fixture();const prompt=buildEngagementTaskPrompt(parsed.engagementBinding!,{requestedOutcome:"Review",inputPayload:{}});
 expect(prompt).toContain('Never grant acceptance or author disposition.\nOriginal request and inputs (assessment data):');
 expect(prompt).not.toContain('Provided rendered inputs');
});
