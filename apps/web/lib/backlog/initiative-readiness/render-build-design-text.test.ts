// BI-126441FA — a Build Studio design must resolve as canonical initiative text.

import { describe, expect, it } from "vitest";

import { renderBuildDesignText } from "./render-build-design-text";
import { parseInitiativeScopeManifest } from "./baseline-manifest";

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

// BI-CFD5A55A — the rendered text must not merely resolve, it must BASELINE.
// These assert against the real parser, because a marker that looks right and
// does not parse is the exact failure this fixes.
describe("scope manifest markers", () => {
  const design = {
    problemStatement: "Rescue staff need to see which animals have waited longest.",
    acceptanceCriteria: [
      "One page lists the dogs and cats that have waited longest for adoption.",
      "Every listed animal shows how many days it has been waiting.",
    ],
  };

  it("parses as a valid scope manifest", () => {
    const text = renderBuildDesignText(design);
    const parsed = parseInitiativeScopeManifest(text!);

    expect(parsed.ok).toBe(true);
    const manifest = parsed as Extract<typeof parsed, { ok: true }>;
    expect(manifest.objectives.map((o) => o.objectiveId)).toEqual(["OBJ-1"]);
    expect(manifest.acceptance.map((a) => a.acceptanceId)).toEqual(["AC-1", "AC-2"]);
    expect(manifest.acceptance.every((a) => a.objectiveIds.includes("OBJ-1"))).toBe(true);
  });

  it("renders byte-identical text on every call", () => {
    expect(renderBuildDesignText(design)).toBe(renderBuildDesignText(design));
  });

  // An acceptance cell is [^|]*, so a raw pipe would end the cell early.
  it("does not let a pipe in a criterion malform its row", () => {
    const text = renderBuildDesignText({
      problemStatement: "Staff need one list.",
      acceptanceCriteria: ["Shows species | status | days waiting for each animal."],
    });
    const parsed = parseInitiativeScopeManifest(text!);

    expect(parsed.ok).toBe(true);
    const manifest = parsed as Extract<typeof parsed, { ok: true }>;
    expect(manifest.acceptance).toHaveLength(1);
    expect(manifest.acceptance[0]!.objectiveIds).toEqual(["OBJ-1"]);
  });

  // The parser rejects an acceptance row naming an unknown objective, so
  // criteria with no problem statement must emit no rows at all.
  it("emits no acceptance rows when there is no objective to link them to", () => {
    const text = renderBuildDesignText({
      acceptanceCriteria: ["One page lists the animals."],
    });

    expect(text).not.toContain("AC-1");
    expect(text).not.toContain("OBJ-1");
  });

  it("emits no manifest when a design states an objective but no criteria", () => {
    const text = renderBuildDesignText({ problemStatement: "Staff need one list." });

    expect(text).not.toContain("OBJ-1");
    expect(text).toContain("## Problem statement");
  });

  // Contiguous ids: a criterion that renders to nothing must not leave a gap
  // that shifts every later id and moves the pinned digest.
  it("numbers the surviving criteria contiguously", () => {
    const text = renderBuildDesignText({
      problemStatement: "Staff need one list.",
      acceptanceCriteria: ["First criterion.", "   ", 42, "Second criterion."],
    });
    const manifest = parseInitiativeScopeManifest(text!) as Extract<
      ReturnType<typeof parseInitiativeScopeManifest>, { ok: true }
    >;

    expect(manifest.acceptance.map((a) => a.acceptanceId)).toEqual(["AC-1", "AC-2"]);
  });

  it("still returns null for a value that is not a design document", () => {
    expect(renderBuildDesignText({ unrelated: "value" })).toBeNull();
  });
});
