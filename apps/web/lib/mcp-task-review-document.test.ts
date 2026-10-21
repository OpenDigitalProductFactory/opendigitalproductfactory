import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("./backlog/initiative-readiness/artifact-resolver", () => ({ resolveInitiativeArtifact: resolve }));
import { reviewDocumentPreflight, validateReviewDocument } from "./mcp-task-review-document";
import { renderBuildDesignText } from "./backlog/initiative-readiness/render-build-design-text";

const binding: InitiativeReviewBinding = { writerToolName: "record_initiative_design_review", itemId: "BI-SCOPE",
  gate: "spec-approval", artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo",
    commitSha: "a".repeat(40), providerBlobId: "b".repeat(40), path: "docs/superpowers/specs/design.md" } };
const text = renderBuildDesignText({ problemStatement: "Keep source.", acceptanceCriteria: ["Keep A | B."] })!;
const digest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
const artifact = { ref: binding.artifactRef, bytes: Buffer.from(text), digest, authorPrincipalId: "author", authorAgentId: null };
beforeEach(() => { resolve.mockReset(); resolve.mockResolvedValue({ ok: true, artifact }); });

describe("review document preflight", () => {
  it("checks the immutable artifact and governed subject without changing its bytes", async () => {
    expect(await validateReviewDocument(binding)).toBeNull();
    expect(resolve).toHaveBeenCalledWith({ locator: binding.artifactRef, subject: { kind: "backlog-item", id: "BI-SCOPE" } });
    expect(artifact.bytes.toString()).toBe(text);
  });
  it.each([undefined, { ...binding, gate: "plan-review" }, { ...binding, writerToolName: "record_initiative_architecture_review" }])
    ("does not require scope markers for unrelated document roles", async value => {
      expect(await validateReviewDocument(value)).toBeNull();
      expect(resolve).not.toHaveBeenCalled();
    });
  it("reports an unavailable source as unrun and permits the same request after restoration", async () => {
    resolve.mockRejectedValueOnce(new Error("network unavailable"));
    expect(await validateReviewDocument(binding)).toMatchObject({ error: "IMMUTABLE_SOURCE_UNAVAILABLE", gateStatus: "unrun" });
    expect(await validateReviewDocument(binding)).toBeNull();
  });
  it.each(["ARTIFACT_AUTHOR_REQUIRED", "CANONICAL_DESIGN_AMBIGUOUS", "CANONICAL_DESIGN_REQUIRED"])
    ("preserves resolver refusal %s", async code => {
      resolve.mockResolvedValue({ ok: false, code, error: "Source ownership or identity was not established." });
      expect(await validateReviewDocument(binding)).toMatchObject({ error: code, gateStatus: "unrun" });
    });
  it("rejects invalid UTF-8", async () => {
    resolve.mockResolvedValue({ ok: true, artifact: { ...artifact, bytes: Uint8Array.of(0xff) } });
    expect(await validateReviewDocument(binding)).toMatchObject({ error: "manifest-invalid", gateStatus: "unrun" });
  });
  it("checks the exact structured revision digest before using its rendered scope", async () => {
    const revision = { ...binding, artifactRef: { kind: "feature-build-revision" as const,
      repositoryFullName: "org/repo", revisionId: "revision-1", valueDigest: digest } };
    expect(await validateReviewDocument(revision)).toBeNull();
    expect(await validateReviewDocument({ ...revision, artifactRef: { ...revision.artifactRef, valueDigest: "d".repeat(64) } }))
      .toMatchObject({ error: "IMMUTABLE_BLOB_MISMATCH", gateStatus: "unrun" });
  });
});

// BI-4592CF69: a design over the terminal-writer recovery cap can never finish
// a resumed review. Say so when the review is requested, not at the failed resume.
describe("review document size at request time", () => {
  const large = `${text}

${"Long design prose. ".repeat(3_600)}
`;
  const largeArtifact = { ...artifact, bytes: Buffer.from(large) };

  it("tells the author the design size and the recovery cap, and still allows the request", async () => {
    resolve.mockResolvedValue({ ok: true, artifact: largeArtifact });
    const result = await reviewDocumentPreflight(binding);
    expect(result.refusal).toBeNull();
    expect(result.notice).toContain(`${String(large.length).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} characters`);
    expect(result.notice).toContain("64,000 characters");
  });

  it("checks the design-spec review too, without requiring scope markers", async () => {
    resolve.mockResolvedValue({ ok: true, artifact: { ...largeArtifact, bytes: Buffer.from("x".repeat(64_001)) } });
    const result = await reviewDocumentPreflight({ ...binding, gate: "design-spec" });
    expect(result).toMatchObject({ refusal: null, notice: expect.stringContaining("64,001 characters") });
  });

  it("says nothing for a design within the cap", async () => {
    expect(await reviewDocumentPreflight(binding)).toEqual({ refusal: null, notice: null });
    expect(await reviewDocumentPreflight({ ...binding, gate: "design-spec" })).toEqual({ refusal: null, notice: null });
  });

  it("never refuses a design-spec request because its size could not be read", async () => {
    resolve.mockRejectedValue(new Error("network unavailable"));
    expect(await reviewDocumentPreflight({ ...binding, gate: "design-spec" })).toEqual({ refusal: null, notice: null });
  });

  it("keeps the scope refusal for spec approval", async () => {
    resolve.mockResolvedValue({ ok: true, artifact: { ...artifact, bytes: Uint8Array.of(0xff) } });
    expect((await reviewDocumentPreflight(binding)).refusal).toMatchObject({ error: "manifest-invalid" });
  });
});
