import { describe, expect, it } from "vitest";

import {
  createInitiativeReviewTerminalToolPolicy,
  immutablePageReaderForArtifact,
  immutableReaderArgumentsFor,
  isImmutablePageReader,
  normalizeTerminalToolArguments,
} from "./terminal-tool-policy";

// BI-926A7E90: the terminal reader policy is reader-agnostic. A Build Studio
// design revision binds to `read_build_artifact_revision` with the same four
// identity keys a repository blob binds to `read_source_at_version`.
describe("terminal tool policy — Build Studio revision reader", () => {
  it("binds a Build Studio design revision to read_build_artifact_revision with the same identity keys (BI-926A7E90)", () => {
    const revisionPolicy = createInitiativeReviewTerminalToolPolicy("record_initiative_design_review", [
      "record_initiative_design_review",
      "read_build_artifact_revision",
    ], {
      kind: "feature-build-revision",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      revisionId: "rev_123",
      valueDigest: "sha256:abc",
    });
    expect(revisionPolicy).toMatchObject({
      readerToolNames: ["read_build_artifact_revision"],
      immutableReaderToolName: "read_build_artifact_revision",
      immutableReaderArguments: {
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        path: "build-artifact-revision/rev_123",
        version: "rev_123",
        expectedBlobId: "sha256:abc",
      },
    });
    // The revision reader is identity-bound exactly as the blob reader is.
    expect(normalizeTerminalToolArguments(revisionPolicy!, "read_build_artifact_revision", { version: "rev_999" })).toMatchObject({ kind: "refuse" });
    expect(normalizeTerminalToolArguments(revisionPolicy!, "read_build_artifact_revision", {})).toMatchObject({
      kind: "allow",
      arguments: expect.objectContaining({ path: "build-artifact-revision/rev_123", expectedBlobId: "sha256:abc" }),
    });
  });

  it("maps each artifact kind to its page reader and identity", () => {
    expect(immutablePageReaderForArtifact({ repositoryFullName: "o/r", path: "docs/a.md", commitSha: "c", providerBlobId: "b" })).toBe("read_source_at_version");
    expect(immutablePageReaderForArtifact({ kind: "feature-build-revision", repositoryFullName: "o/r", revisionId: "rev_1", valueDigest: "d" })).toBe("read_build_artifact_revision");
    expect(immutableReaderArgumentsFor({ repositoryFullName: "o/r", path: "docs/a.md", commitSha: "c", providerBlobId: "b" }))
      .toEqual({ repositoryFullName: "o/r", path: "docs/a.md", version: "c", expectedBlobId: "b" });
    expect(isImmutablePageReader("read_build_artifact_revision")).toBe(true);
    expect(isImmutablePageReader("search_source_at_version")).toBe(false);
  });
});
