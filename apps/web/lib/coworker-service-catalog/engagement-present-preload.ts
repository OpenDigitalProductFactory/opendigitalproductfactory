import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ToolResult } from "../mcp-tool-types";
import { capturedJsonValue } from "../shared/captured-effect-store";
import type { EngagementPresentPolicy } from "./engagement-present-policy";
import type { EngagementTaskBinding } from "./engagement-task-binding";
import { fullReassessmentToolResult } from "../tak/reassessment-preload";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type Span = { startByte: number; endByte: number; sha256: string };
export type EngagementSourceBasis = {
  kind: "rendered-ux-with-static-source-v1"; originalSha256: string; originalBytes: number;
  modelSourceSha256: string; content: string; fullRawSourceModelCoverage: false;
  retainedSpans: Span[]; omissions: Array<Span & { category: "stylesheet" | "script-implementation" }>;
};

/** Versioned mechanical projection, not a claim to understand or execute HTML.
 * Exact UTF8 spans disclose every omitted block; original read receipts remain complete. */
export function projectEngagementStaticSource(source: string): EngagementSourceBasis {
  if (typeof source !== "string" || Buffer.byteLength(source) > 250_000) throw new Error("source-basis-limit");
  if (Buffer.from(source).toString("utf8") !== source) throw new Error("source-basis-incomplete");
  const retainedSpans: Span[] = [], omissions: EngagementSourceBasis["omissions"] = [];
  let cursor = 0, content = "";
  const span = (start: number, end: number): Span => ({ startByte: Buffer.byteLength(source.slice(0, start)),
    endByte: Buffer.byteLength(source.slice(0, end)), sha256: sha(source.slice(start, end)) });
  for (const match of source.matchAll(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)) {
    const start = match.index, end = start + match[0].length;
    if (start > cursor) retainedSpans.push(span(cursor, start));
    content += source.slice(cursor, start);
    const omission = { ...span(start, end), category: match[1]!.toLowerCase() === "style" ? "stylesheet" as const : "script-implementation" as const };
    omissions.push(omission);
    content += `\n[OMITTED ${omission.category}; original UTF8 bytes ${omission.startByte}..${omission.endByte}; SHA256 ${omission.sha256}]\n`;
    cursor = end;
  }
  if (cursor < source.length) retainedSpans.push(span(cursor, source.length));
  content += source.slice(cursor);
  if (/<\/?(?:style|script)\b/i.test(content)) throw new Error("source-basis-incomplete");
  return { kind: "rendered-ux-with-static-source-v1", originalSha256: sha(source), originalBytes: Buffer.byteLength(source),
    modelSourceSha256: sha(content), content, fullRawSourceModelCoverage: false, retainedSpans, omissions };
}

type Artifact = EngagementTaskBinding["artifactRef"];
export type EngagementPreload = {
  modelBasis: EngagementSourceBasis;
  fullSourceEvidence: Array<{ artifactRef: Artifact; contentSha256: string; bytes: number; readCalls: number }>;
  fullGuidance: Array<{ artifactRef: Artifact; content: string }>;
  professionCorpus: unknown; calibrationCorpus: unknown;
  executedTools: Array<{ name: string; args: Record<string, unknown>; result: ToolResult }>;
};
/** Called only inside the real registered Critic TaskRun. The supplied port is
 * the ordinary governed executor with its admitted user, Critic and full fence. */
export async function preloadEngagementPresent(policy: EngagementPresentPolicy,
  execute: (toolName: string, args: Record<string, unknown>) => Promise<ToolResult>): Promise<EngagementPreload> {
  const records: EngagementPreload["executedTools"] = [], sourceEvidence: EngagementPreload["fullSourceEvidence"] = [];
  const texts: string[] = []; let bytes = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    if (!policy.readers.includes(name as typeof policy.readers[number]) || records.length >= policy.limits.maxToolCalls) throw new Error("engagement-present-reader-limit");
    const result = await execute(name, args);
    records.push({ name, args, result });
    if (!result.success) throw new Error(`engagement-present-reader-refused:${name}`);
    fullReassessmentToolResult(result, name);
    return result;
  };
  for (const artifact of [policy.originalBinding.artifactRef, ...(policy.originalBinding.guidanceArtifacts ?? [])]) {
    let source = "", cursor: string | null = null, expectedChars: number | null = null, calls = 0;
    const seen = new Set<string>();
    for (;;) {
      const result = await call("read_source_at_version", { repositoryFullName: artifact.repositoryFullName,
        version: artifact.commitSha, path: artifact.path, expectedBlobId: artifact.providerBlobId,
        maxChars: 16_000, maxLines: 400, ...(cursor ? { cursor } : { startLine: 1 }) });
      calls++;
      const data = result.data;
      if (typeof data?.content !== "string" || !data.content.length || data.truncated === true
        || data.repositoryFullName !== artifact.repositoryFullName || data.version !== artifact.commitSha
        || data.path !== artifact.path || data.blobId !== artifact.providerBlobId || typeof data.hasMore !== "boolean"
        || !Number.isSafeInteger(data.totalChars) || Number(data.totalChars) <= 0
        || expectedChars !== null && expectedChars !== data.totalChars) throw new Error("engagement-present-source-incomplete");
      expectedChars = Number(data.totalChars); source += data.content;
      if (source.length > expectedChars || bytes + Buffer.byteLength(source) > policy.limits.maxSourceBytes) throw new Error("engagement-present-source-limit");
      if (!data.hasMore) { if (data.nextCursor !== null) throw new Error("engagement-present-source-incomplete"); break; }
      if (typeof data.nextCursor !== "string" || !data.nextCursor || seen.has(data.nextCursor)) throw new Error("engagement-present-source-incomplete");
      cursor = data.nextCursor; seen.add(cursor);
    }
    const sourceBytes = Buffer.from(source), blob = createHash(artifact.providerBlobId.length === 40 ? "sha1" : "sha256")
      .update(`blob ${sourceBytes.length}\0`).update(sourceBytes).digest("hex");
    if (source.length !== expectedChars || blob !== artifact.providerBlobId) throw new Error("engagement-present-source-identity-changed");
    bytes += sourceBytes.length; texts.push(source);
    sourceEvidence.push({ artifactRef: artifact, contentSha256: sha(source), bytes: sourceBytes.length, readCalls: calls });
  }
  const profession = await call("wiki_query", { query: "information hierarchy density heuristic evaluation design critique calibration",
    professionKey: "ux-design", includeProfessionCorpus: true, retrievalMode: "lexical", limit: 8 });
  if (profession.data?.retrievalMode !== "lexical") throw new Error("engagement-present-wiki-mode-unproven");
  const calibration = await call("search_ux_critique_corpus", { calibratedOnly: true, limit: 20 });
  if (Buffer.byteLength(canonicalJson([profession.data, calibration.data])) > 48_000) throw new Error("engagement-present-corpus-input-limit");
  return { modelBasis: projectEngagementStaticSource(texts[0]!), fullSourceEvidence: sourceEvidence,
    fullGuidance: (policy.originalBinding.guidanceArtifacts ?? []).map((artifactRef, index) => ({ artifactRef, content: texts[index + 1]! })),
    professionCorpus: capturedJsonValue(profession.data), calibrationCorpus: capturedJsonValue(calibration.data), executedTools: records };
}