import { describe, expect, it } from "vitest";
import {
  deriveBuildActivityStory,
  groupOperatorBuilds,
} from "./build-studio-operator-view";

describe("Build Studio operator view model", () => {
  it("groups attention first, active work second, and completed work as recent history", () => {
    const groups = groupOperatorBuilds([
      {
        id: "complete",
        buildId: "FB-COMPLETE",
        title: "Shipped customer portal",
        phase: "complete",
        updatedAt: new Date("2026-07-26T12:00:00Z"),
        needsYou: false,
      },
      {
        id: "working",
        buildId: "FB-WORKING",
        title: "Improve invoice reminders",
        phase: "build",
        updatedAt: new Date("2026-07-28T10:00:00Z"),
        needsYou: false,
      },
      {
        id: "decision",
        buildId: "FB-DECISION",
        title: "Choose delivery policy",
        phase: "plan",
        updatedAt: new Date("2026-07-27T15:00:00Z"),
        needsYou: true,
      },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Needs you",
      "In progress",
      "Recent",
    ]);
    expect(groups[0].builds.map((build) => build.buildId)).toEqual(["FB-DECISION"]);
    expect(groups[1].builds.map((build) => build.buildId)).toEqual(["FB-WORKING"]);
    expect(groups[2].builds.map((build) => build.buildId)).toEqual(["FB-COMPLETE"]);
  });

  it("keeps implementation phases as a compact evidence story instead of operator instructions", () => {
    const story = deriveBuildActivityStory("review");

    expect(story.map((step) => step.label)).toEqual([
      "Outcome understood",
      "Approach shaped",
      "Solution built",
      "Quality checked",
      "Ready to use",
    ]);
    expect(story.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "current",
      "upcoming",
    ]);
    expect(story.find((step) => step.state === "current")?.detail).toMatch(
      /evidence|checks/i,
    );
  });

  it("treats a failed build as attention-worthy without pretending progress was lost", () => {
    const story = deriveBuildActivityStory("failed");

    expect(story.some((step) => step.state === "complete")).toBe(true);
    expect(story.at(-1)).toMatchObject({
      label: "Needs recovery",
      state: "attention",
    });
  });
});
