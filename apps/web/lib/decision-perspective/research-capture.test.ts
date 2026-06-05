import { describe, expect, it } from "vitest";
import { captureResearchCandidate } from "./research-capture";

describe("captureResearchCandidate", () => {
  it("maps markdown frontmatter into draft source metadata", () => {
    const candidate = captureResearchCandidate({
      targetProfileId: "profile-mark",
      targetPerspective: "wwmd",
      content: [
        "---",
        "title: Obsidian Backlinks",
        "url: https://example.test/obsidian",
        "authors: [Researcher One, Researcher Two]",
        "retrievedAt: 2026-05-31T12:00:00.000Z",
        "---",
        "Backlinks help decisions expose related principles.",
      ].join("\n"),
      proposedPageKind: "heuristic",
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.rawSource?.title).toBe("Obsidian Backlinks");
    expect(candidate.rawSource?.url).toBe("https://example.test/obsidian");
    expect(candidate.rawSource?.authors).toEqual(["Researcher One", "Researcher Two"]);
    expect(candidate.rawSource?.status).toBe("draft");
    expect(candidate.wikiPageCandidate?.status).toBe("review-needed");
    expect(candidate.wikiPageCandidate?.pageKind).toBe("heuristic");
    expect(candidate.materialCandidate?.reviewStatus).toBe("draft");
    expect(candidate.materialCandidate?.promotionState).toBe("candidate");
  });

  it("fails validation when no target profile is supplied", () => {
    const candidate = captureResearchCandidate({
      content: "A useful note without a profile target.",
    });

    expect(candidate.valid).toBe(false);
    expect(candidate.errors).toContain("targetProfileId is required");
    expect(candidate.rawSource).toBeNull();
  });

  it("creates a local-source candidate when no URL is supplied", () => {
    const candidate = captureResearchCandidate({
      targetProfileId: "profile-org",
      targetPerspective: "wwwd",
      title: "Local customer promise note",
      content: "The organization promises same-day escalation for urgent cases.",
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.rawSource?.sourceType).toBe("doc");
    expect(candidate.rawSource?.url).toBeNull();
    expect(candidate.rawSource?.locator.captureMode).toBe("local-note");
    expect(candidate.materialCandidate?.targetPerspective).toBe("wwwd");
  });

  it("flags secret-looking input and blocks automatic capture", () => {
    const candidate = captureResearchCandidate({
      targetProfileId: "profile-mark",
      content: "token=dpfmcp_secretvalue should not become doctrine.",
    });

    expect(candidate.valid).toBe(false);
    expect(candidate.flags).toEqual(["secret-looking-content"]);
    expect(candidate.errors).toContain("secret-looking content must be reviewed before capture");
  });

  it("never emits active, promoted, or published candidates", () => {
    const candidate = captureResearchCandidate({
      targetProfileId: "profile-mark",
      content: "Captured material remains draft until review.",
    });

    expect(candidate.rawSource?.status).toBe("draft");
    expect(candidate.wikiPageCandidate?.status).toBe("review-needed");
    expect(candidate.materialCandidate?.reviewStatus).toBe("draft");
    expect(candidate.materialCandidate?.promotionState).toBe("candidate");
    expect(JSON.stringify(candidate)).not.toMatch(/"active"|"promoted"|"published"/);
  });
});
