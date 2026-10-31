import { describe, expect, it } from "vitest";
import { projectEngagementStaticSource } from "./engagement-present-preload";
import { createHash } from "node:crypto";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("explicit bounded visual source basis", () => {
  it("retains static interface text and exact omitted UTF8 spans without claiming full model coverage", () => {
    const source = '<!doctype html><html><head><style>.x{color:red}</style></head><body>Résumé<button>Inspect reason</button><script>unsafe()</script></body></html>';
    const projected = projectEngagementStaticSource(source);
    expect(projected.kind).toBe("rendered-ux-with-static-source-v1");
    expect(projected.originalSha256).toBe(sha(source));
    expect(projected.fullRawSourceModelCoverage).toBe(false);
    expect(projected.content).toContain('Résumé<button>Inspect reason</button>');
    expect(projected.content).not.toContain('.x{color:red}');
    expect(projected.content).not.toContain('unsafe()');
    expect(projected.omissions.map(x => x.category)).toEqual(["stylesheet", "script-implementation"]);
    const bytes = Buffer.from(source);
    for (const omission of projected.omissions) {
      expect(createHash("sha256").update(bytes.subarray(omission.startByte, omission.endByte)).digest("hex")).toBe(omission.sha256);
    }
    expect(projected.modelSourceSha256).toBe(sha(projected.content));
    expect(projectEngagementStaticSource(source)).toEqual(projected);
  });
  it("covers the entire original by retained and omitted spans, including line endings and multibyte text", () => {
    const source = '<html>é\r\n<STYLE media="all">\r\nx\r\n</STYLE><body>x</body><script type="module">code</script></html>';
    const projected = projectEngagementStaticSource(source);
    expect(projected.retainedSpans.reduce((n, x) => n + x.endByte - x.startByte, 0)
      + projected.omissions.reduce((n, x) => n + x.endByte - x.startByte, 0)).toBe(Buffer.byteLength(source));
    expect(projected.content).toContain('é\r\n');
  });
  it("does not silently truncate source or accept incomplete omitted blocks", () => {
    expect(() => projectEngagementStaticSource('<html><style>unfinished')).toThrow('source-basis-incomplete');
    expect(() => projectEngagementStaticSource('<html><script>unfinished')).toThrow('source-basis-incomplete');
    expect(() => projectEngagementStaticSource('x'.repeat(250_001))).toThrow('source-basis-limit');
  });
  it("does not strip executable-looking text from a complete source that has no omitted blocks", () => {
    const source = '<html><body><button onclick="select()">Open</button></body></html>';
    const projected = projectEngagementStaticSource(source);
    expect(projected.content).toBe(source);
    expect(projected.omissions).toEqual([]);
  });
});
import { preloadEngagementPresent } from "./engagement-present-preload";
import { issueEngagementPresentPolicy } from "./engagement-present-policy";
import type { ToolResult } from "../mcp-tool-types";
const prototype = '<html>é<style>.x{color:red}</style><body><button>Inspect reason</button></body><script>code()</script></html>\n';
const guide = "Full pinned craft guidance.\n";
const blob = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
function preloadFixture() {
  const base = { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repo", commitSha: "b".repeat(40) };
  const binding = { version: 1 as const, engagementId: "CE-1FE20783", offerId: "offer-ux-design-critique", serviceId: "svc-ux-design-critique",
    providerAgentId: "ux-design-critic", actorAgentId: "actor", userId: "owner", workroomId: "WC-9C02621A", stageKey: "accept", roomHeadSha: base.commitSha,
    inputDigest: "a".repeat(64), artifactRef: { ...base, path: "prototype.html", providerBlobId: blob(prototype) },
    guidanceArtifacts: [{ ...base, path: "docs/professions/ux-design/wiki/heuristic.md", providerBlobId: blob(guide) }],
    visualEvidenceRef: { kind: "document-version" as const, repositoryFullName: base.repositoryFullName, versionId: "images", valueDigest: "d".repeat(64) } };
  const policy = issueEngagementPresentPolicy({ binding, originalTaskRunId: "TR-MCP-original", originalRequestDigest: "e".repeat(64),
    originalFence: { schemaVersion: 1, reservation: null, dispatchClaim: "held", authorityDigest: null, requestDigest: "e".repeat(64) },
    issuedAt: new Date().toISOString(), budgetConfigurationDigest: "f".repeat(64), providerConfigurationDigest: "1".repeat(64), compositionDigest: "2".repeat(64),
    limits: { perTaskTokens: 20000, maxOutputTokens: 2048, timeoutMs: 180000, maxProviderStarts: 12, maxToolCalls: 40, maxSourceBytes: 250000, maxImageBytes: 4000000, maxImagePixels: 40000000 } });
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const execute = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    calls.push({ name, args });
    if (name === "read_source_at_version") {
      const source = args.path === "prototype.html" ? prototype : guide;
      const offset = args.cursor === undefined ? 0 : Number(args.cursor), end = Math.min(source.length, offset + 13);
      return { success: true, message: "Complete synthetic page", data: { repositoryFullName: base.repositoryFullName, version: base.commitSha,
        path: args.path, blobId: args.expectedBlobId, content: source.slice(offset, end), totalChars: source.length,
        hasMore: end < source.length, nextCursor: end < source.length ? String(end) : null } };
    }
    if (name === "wiki_query") return { success: true, message: "Actual synthetic lexical retrieval", data: {
      retrievalMode: "lexical", results: [{ slug: "professions/ux-design/heuristic", contentPreview: "Pinned criteria preview" }] } };
    return { success: true, message: "No calibrated critiques", data: { calibratedOnly: true, total: 0, grounding: "UNGROUNDED" } };
  };
  return { policy, calls, execute };
}
describe("governed finite evidence preparation", () => {
  it("traverses every immutable page, verifies Git bytes, and explicitly selects lexical WSID plus calibratedOnly", async () => {
    const f = preloadFixture(), result = await preloadEngagementPresent(f.policy, f.execute);
    expect(result.fullSourceEvidence).toHaveLength(2);
    expect(result.fullSourceEvidence[0]).toMatchObject({ bytes: Buffer.byteLength(prototype), contentSha256: sha(prototype) });
    expect(result.fullGuidance[0]?.content).toBe(guide);
    expect(result.modelBasis.originalSha256).toBe(sha(prototype)); expect(result.modelBasis.fullRawSourceModelCoverage).toBe(false);
    expect(f.calls.filter(c => c.name === "read_source_at_version").length).toBeGreaterThan(2);
    expect(f.calls.at(-2)).toMatchObject({ name: "wiki_query", args: { professionKey: "ux-design", includeProfessionCorpus: true, retrievalMode: "lexical" } });
    expect(f.calls.at(-1)).toEqual({ name: "search_ux_critique_corpus", args: { calibratedOnly: true, limit: 20 } });
    expect(result.calibrationCorpus).toMatchObject({ total: 0, grounding: "UNGROUNDED" });
  });
  it("refuses changed complete source bytes even if the reader reports the expected blob identity", async () => {
    const f = preloadFixture(); let changed = false;
    await expect(preloadEngagementPresent(f.policy, async (name,args) => {
      const result = await f.execute(name,args);
      if (!changed && name === "read_source_at_version") { result.data!.content = "X" + String(result.data!.content).slice(1); changed = true; }
      return result;
    })).rejects.toThrow("engagement-present-source-identity-changed");
    expect(f.calls.some(c => c.name === "wiki_query")).toBe(false);
  });
  it("refuses repeating cursors, a reader denial, or a nonlexical response instead of claiming complete evidence", async () => {
    const f = preloadFixture();
    await expect(preloadEngagementPresent(f.policy, async (name,args) => {
      const result = await f.execute(name,args);
      if (name === "read_source_at_version") result.data!.nextCursor = "1";
      return result;
    })).rejects.toThrow("engagement-present-source-incomplete");
    await expect(preloadEngagementPresent(f.policy, async () => ({ success: false, message: "Native read denied" })))
      .rejects.toThrow("engagement-present-reader-refused");
    await expect(preloadEngagementPresent(f.policy, async (name,args) => {
      const result = await f.execute(name,args); if (name === "wiki_query") result.data!.retrievalMode = "vector"; return result;
    })).rejects.toThrow("engagement-present-wiki-mode-unproven");
  });
});
