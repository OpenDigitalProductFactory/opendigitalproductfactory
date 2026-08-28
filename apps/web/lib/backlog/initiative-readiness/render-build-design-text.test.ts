// BI-126441FA — a Build Studio design must resolve as canonical initiative text.

import { describe, expect, it } from "vitest";

import { renderBuildDesignText } from "./render-build-design-text";

// The exact key set stored on FB-EB292B9F, the build this unblocked.
const DESIGN = {
  dataModel: { WaitlistEntry: "joinedAt, status, entityType" },
  reusePlan: ["reuse the storefront animal list query"],
  targetRoles: ["adoption coordinator"],
  accessibility: "Semantic table, keyboard operable.",
  problemStatement: "Animals waiting longest get overlooked.",
  proposedApproach: "One page ordered by joinedAt ascending.",
  acceptanceCriteria: ["Oldest first", "Shows days waiting"],
  reusabilityAnalysis: "No existing surface lists waiting time.",
  existingFunctionalityAudit: "AdoptableAnimal already stores intakeDate.",
};

describe("renderBuildDesignText", () => {
  it("renders a Build Studio design document", () => {
    const text = renderBuildDesignText(DESIGN)!;
    expect(text).toContain("## Problem statement");
    expect(text).toContain("Animals waiting longest get overlooked.");
    expect(text).toContain("- Oldest first");
    expect(text).toContain("**WaitlistEntry**");
  });

  // A baseline pins a digest and reviewers read this text, so the same stored
  // value must always produce byte-identical output.
  it("is deterministic regardless of key order", () => {
    const shuffled = Object.fromEntries(Object.entries(DESIGN).reverse());
    expect(renderBuildDesignText(shuffled)).toBe(renderBuildDesignText(DESIGN));
  });

  it("orders sections by the fixed contract, not by key order", () => {
    const text = renderBuildDesignText(DESIGN)!;
    expect(text.indexOf("## Problem statement")).toBeLessThan(text.indexOf("## Proposed approach"));
    expect(text.indexOf("## Proposed approach")).toBeLessThan(text.indexOf("## Acceptance criteria"));
  });

  it("omits sections the design does not carry", () => {
    const text = renderBuildDesignText({ problemStatement: "Only this." })!;
    expect(text).toContain("## Problem statement");
    expect(text).not.toContain("## Data model");
  });

  // An object that is not a design document must not be dressed up as one.
  it("returns null for a value carrying no known section", () => {
    expect(renderBuildDesignText({ unrelated: "value" })).toBeNull();
    expect(renderBuildDesignText({})).toBeNull();
    expect(renderBuildDesignText(null)).toBeNull();
    expect(renderBuildDesignText("a string")).toBeNull();
    expect(renderBuildDesignText([1, 2])).toBeNull();
  });

  it("ignores empty sections rather than emitting a bare heading", () => {
    const text = renderBuildDesignText({ problemStatement: "Real.", reusePlan: [], accessibility: "   " })!;
    expect(text).not.toContain("## Reuse plan");
    expect(text).not.toContain("## Accessibility");
  });
});
