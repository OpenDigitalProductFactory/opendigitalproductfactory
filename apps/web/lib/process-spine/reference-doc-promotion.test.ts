import { describe, expect, it } from "vitest";
import {
  extractReferenceDocIssues,
  referenceDocProposalBody,
  referenceDocProposalTitle,
} from "./reference-doc-promotion";

describe("reference-doc-promotion", () => {
  it("extracts only [reference-doc] issues", () => {
    const issues = [
      { severity: "minor", description: "[reference-doc] AGENTS.md — missing hook roster" },
      { severity: "important", description: "Schema drift in Epic model" },
    ];
    expect(extractReferenceDocIssues(issues)).toHaveLength(1);
    expect(extractReferenceDocIssues(issues)[0].description).toContain("AGENTS.md");
  });

  it("builds proposal title and body", () => {
    const issue = {
      severity: "minor",
      description: "[reference-doc] docs/foo.md — add lease guard note",
      suggestion: "Add a paragraph under §5.",
    };
    expect(referenceDocProposalTitle(issue)).toMatch(/^\[reference-doc\]/);
    expect(referenceDocProposalBody(issue)).toContain("Suggested edit:");
    expect(referenceDocProposalBody(issue)).toContain("architecture review");
  });
});