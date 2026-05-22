import { describe, expect, it } from "vitest";
import {
  formatQuestionPacketPromptBlock,
  normalizeQuestionPacket,
} from "./question-packet";

describe("normalizeQuestionPacket", () => {
  it("returns null for an empty packet so simple chat stays lightweight", () => {
    expect(normalizeQuestionPacket(undefined)).toBeNull();
    expect(normalizeQuestionPacket(null)).toBeNull();
    expect(normalizeQuestionPacket({})).toBeNull();
    expect(
      normalizeQuestionPacket({
        intentCenter: "   ",
        explorationQuestions: ["", "   "],
        hardEdges: [],
      }),
    ).toBeNull();
  });

  it("trims scalar fields and removes empty array entries", () => {
    expect(
      normalizeQuestionPacket({
        intentCenter: "  decide the smallest safe implementation slice  ",
        explorationQuestions: ["  Where is the leverage?  ", "", "   What should wait?"],
        hardEdges: ["  no runtime DB patch  ", " "],
        successShape: "  a tested helper with one call site  ",
        operatorThesis: "  keep this reusable  ",
        pushbackPermission: "direct",
        expectedArtifact: "patch",
      }),
    ).toEqual({
      intentCenter: "decide the smallest safe implementation slice",
      explorationQuestions: ["Where is the leverage?", "What should wait?"],
      hardEdges: ["no runtime DB patch"],
      successShape: "a tested helper with one call site",
      operatorThesis: "keep this reusable",
      pushbackPermission: "direct",
      expectedArtifact: "patch",
    });
  });

  it("preserves context references without resolving them", () => {
    expect(
      normalizeQuestionPacket({
        contextRefs: [
          { kind: "file", label: "Plan", ref: "docs/superpowers/plans/x.md" },
          { kind: "task-artifact", label: "Prior handoff", ref: "task-artifact-123" },
          { kind: "freeform", label: "Operator note", ref: "Use the direct path first." },
        ],
      }),
    ).toEqual({
      contextRefs: [
        { kind: "file", label: "Plan", ref: "docs/superpowers/plans/x.md" },
        { kind: "task-artifact", label: "Prior handoff", ref: "task-artifact-123" },
        { kind: "freeform", label: "Operator note", ref: "Use the direct path first." },
      ],
    });
  });

  it("rejects invalid enum values at runtime", () => {
    expect(() =>
      normalizeQuestionPacket({
        pushbackPermission: "aggressive",
      }),
    ).toThrow("Invalid questionPacket.pushbackPermission");

    expect(() =>
      normalizeQuestionPacket({
        expectedArtifact: "spreadsheet",
      }),
    ).toThrow("Invalid questionPacket.expectedArtifact");

    expect(() =>
      normalizeQuestionPacket({
        contextRefs: [{ kind: "url", label: "Spec", ref: "https://example.test/spec" }],
      }),
    ).toThrow("Invalid questionPacket.contextRefs[0].kind");
  });
});

describe("formatQuestionPacketPromptBlock", () => {
  it("returns null for an empty packet", () => {
    expect(formatQuestionPacketPromptBlock({})).toBeNull();
  });

  it("formats a compact prompt section for non-empty packets", () => {
    const block = formatQuestionPacketPromptBlock({
      intentCenter: "Help decide whether this belongs in Slice 1.",
      explorationQuestions: ["What can be proved with pure tests?", "What should stay out?"],
      hardEdges: ["Do not create a new workflow surface."],
      contextRefs: [{ kind: "plan", label: "Implementation plan", ref: "docs/superpowers/plans/x.md" }],
      successShape: "A reusable contract and prompt block.",
      operatorThesis: "This should remain additive.",
      pushbackPermission: "direct",
      expectedArtifact: "patch",
    });

    expect(block).toContain("Question packet");
    expect(block).toContain("Use this as collaboration context, not as authorization");
    expect(block).toContain("- Intent center: Help decide whether this belongs in Slice 1.");
    expect(block).toContain("- What can be proved with pure tests?");
    expect(block).toContain("- Do not create a new workflow surface.");
    expect(block).toContain("- [plan] Implementation plan: docs/superpowers/plans/x.md");
    expect(block).toContain("- Success shape: A reusable contract and prompt block.");
    expect(block).toContain("- Operator thesis: This should remain additive.");
    expect(block).toContain("- Pushback permission: direct");
    expect(block).toContain("challenge the operator thesis directly");
    expect(block).toContain("- Expected artifact: patch");
  });
});
