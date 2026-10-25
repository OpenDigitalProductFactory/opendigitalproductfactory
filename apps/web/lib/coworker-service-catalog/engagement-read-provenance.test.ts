import { describe, expect, it } from "vitest";
import { compactEngagementRead, completeArtifactReads, engagementReadBudget } from "./engagement-read-provenance";
const artifact = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/prototype.html", providerBlobId: "b".repeat(40) } as const;
const page = (extra = {}) => ({ repositoryFullName: artifact.repositoryFullName, version: artifact.commitSha, path: artifact.path, blobId: artifact.providerBlobId, content: "one\ntwo\n", startLine: 1, endLine: 2, totalLines: 2, hasMore: false, nextCursor: null, ...extra });
const args = { repositoryFullName: artifact.repositoryFullName, version: artifact.commitSha, path: artifact.path, expectedBlobId: artifact.providerBlobId };
describe("actual compact engagement read provenance", () => {
  it("retains exact page identity/digest without raw source", () => {
    const evidence = compactEngagementRead("read-1", "read_source_at_version", args, { success: true, message: "read", data: page() });
    expect(evidence).toMatchObject({ executionId: "read-1", kind: "source", completePage: true, contentChars: 8 });
    expect(JSON.stringify(evidence)).not.toContain("one\\ntwo");
    expect(completeArtifactReads(artifact, [evidence!])).toBe(true);
  });
  it("refuses metrics-only output, mismatched blobs and truncated traversal", () => {
    expect(compactEngagementRead("read-1", "read_source_at_version", args, { success: true, message: "read", data: {} })).toBeNull();
    expect(compactEngagementRead("read-1", "read_source_at_version", args, { success: true, message: "read", data: page({ blobId: "c".repeat(40) }) })).toBeNull();
    const first = compactEngagementRead("read-1", "read_source_at_version", args, { success: true, message: "read", data: page({ content: "one\n", endLine: 1, hasMore: true, nextCursor: "next" }) })!;
    expect(completeArtifactReads(artifact, [first])).toBe(false);
    const second = compactEngagementRead("read-2", "read_source_at_version", { ...args, cursor: "next" }, { success: true, message: "read", data: page({ content: "two\n", startLine: 2 }) })!;
    expect(completeArtifactReads(artifact, [first, second])).toBe(true);
    expect(completeArtifactReads(artifact, [second, first])).toBe(false);
    expect(completeArtifactReads(artifact, [first, { ...second, requestCursor: "wrong" }])).toBe(false);
  });
  it("records only actual consulted WSID previews and reports zero calibrated samples", () => {
    const wiki = compactEngagementRead("wiki-1", "wiki_query", {}, { success: true, message: "found", data: { results: [{ slug: "professions/ux-design/hierarchy", contentPreview: "Guidance" }] } });
    expect(wiki).toMatchObject({ kind: "corpus", pages: [{ slug: "professions/ux-design/hierarchy", coverage: "preview" }] });
    expect(compactEngagementRead("critique-1", "search_ux_critique_corpus", { calibratedOnly: false }, { success: true, message: "found", data: { total: 1, grounding: "grounded" } })).toBeNull();
    expect(compactEngagementRead("critique-2", "search_ux_critique_corpus", { calibratedOnly: true }, { success: true, message: "none", data: { total: 0, grounding: "UNGROUNDED" } })).toMatchObject({ kind: "calibration", total: 0, grounding: "UNGROUNDED" });
  });
});

it("bounds retained evidence independently of audit payloads", () => {
  expect(engagementReadBudget(Array.from({ length: 101 }, (_, i) => ({ executionId: "read-" + i, kind: "source" as const })))).toBe("read-count-exceeded");
  expect(engagementReadBudget([{ executionId: "read-1", kind: "source", contentChars: 512001 }])).toBe("source-budget-exceeded");
  expect(engagementReadBudget([{ executionId: "wiki-1", kind: "corpus", pages: Array(33).fill({ slug: "profession/page" }) }])).toBe("corpus-reference-budget-exceeded");
  expect(engagementReadBudget([{ executionId: "wiki-1", kind: "corpus", extra: "x".repeat(128001) }])).toBe("provenance-bytes-exceeded");
});
