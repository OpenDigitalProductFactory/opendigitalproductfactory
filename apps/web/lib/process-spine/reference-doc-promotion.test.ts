import { describe, expect, it } from "vitest";
import {
  extractReferenceDocIssues,
  isLowSeverityReferenceDocProposal,
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

// ─── Backlog auto-file gate (BI-18685188) ─────────────────────────────────────

describe("isLowSeverityReferenceDocProposal", () => {
  it("suppresses a low-severity [reference-doc] proposal (the scanner's noise class)", () => {
    expect(
      isLowSeverityReferenceDocProposal({
        title: "[reference-doc] AGENTS.md — would benefit from a hook roster",
        severity: "low",
      }),
    ).toBe(true);
  });

  it("does NOT suppress medium/high/critical reference-doc proposals (keep them filing)", () => {
    for (const severity of ["medium", "high", "critical"]) {
      expect(
        isLowSeverityReferenceDocProposal({
          title: "[reference-doc] docs/foo.md — missing lease guard",
          severity,
        }),
      ).toBe(false);
    }
  });

  it("does NOT suppress a low-severity NON-reference-doc proposal (no over-suppression)", () => {
    expect(
      isLowSeverityReferenceDocProposal({
        title: "Estate Specialist — auto-investigate unknown devices",
        severity: "low",
      }),
    ).toBe(false);
  });

  it("matches the [reference-doc] marker only as a title prefix, case-insensitively", () => {
    // Prefix, mixed case → suppressed.
    expect(
      isLowSeverityReferenceDocProposal({ title: "[Reference-Doc] x", severity: "LOW" }),
    ).toBe(true);
    // Marker mid-title (not a prefix) → not the scanner class, still files.
    expect(
      isLowSeverityReferenceDocProposal({
        title: "Fix the [reference-doc] link in the sidebar",
        severity: "low",
      }),
    ).toBe(false);
  });

  it("tolerates leading whitespace and empty severity", () => {
    expect(
      isLowSeverityReferenceDocProposal({ title: "  [reference-doc] y", severity: "low" }),
    ).toBe(true);
    expect(
      isLowSeverityReferenceDocProposal({ title: "[reference-doc] y", severity: "" }),
    ).toBe(false);
  });
});