import { describe, expect, it } from "vitest";

import {
  distillMemoryNotesFromExperience,
  shouldRejectMemoryContent,
} from "./memory-acquisition";

describe("distillMemoryNotesFromExperience", () => {
  it("turns a phase handoff into bounded coworker memory candidates", () => {
    const notes = distillMemoryNotesFromExperience({
      sourceKind: "phase-handoff",
      sourceId: "handoff-1",
      agentId: "AGT-EA",
      title: "Plan handoff",
      summary:
        "Keep memory acquisition deterministic for the first slice. Do not auto-mutate founder doctrine.",
      decisionsMade: [
        "Use the existing recordCoworkerNote path for dedupe and supersession.",
      ],
      openIssues: ["Avoid broad conclusions that would mutate WWMD."],
      userPreferences: [
        "Keep memory acquisition deterministic for the first slice.",
      ],
    });

    expect(notes).toEqual([
      {
        noteKind: "preference",
        noteKey: "memory-acquisition-deterministic-first-slice",
        content: "Keep memory acquisition deterministic for the first slice.",
        sourceRef: "memory-distill:phase-handoff:handoff-1",
      },
      {
        noteKind: "context",
        noteKey: "existing-recordcoworkernote-path-dedupe-supersession",
        content: "Use the existing recordCoworkerNote path for dedupe and supersession.",
        sourceRef: "memory-distill:phase-handoff:handoff-1",
      },
      {
        noteKind: "caution",
        noteKey: "avoid-broad-conclusions-mutate-wwmd",
        content: "Avoid broad conclusions that would mutate WWMD.",
        sourceRef: "memory-distill:phase-handoff:handoff-1",
      },
    ]);
  });

  it("maps completed and failed task/build summaries to context or cautions", () => {
    const completedTask = distillMemoryNotesFromExperience({
      sourceKind: "task-run",
      sourceId: "task-1",
      agentId: "AGT-MKT",
      title: "Source-local Vitest check",
      status: "completed",
      summary: "Source-local Vitest caught the regression before broad gates.",
    });
    const failedBuild = distillMemoryNotesFromExperience({
      sourceKind: "build",
      sourceId: "FB-1",
      agentId: "AGT-BUILD",
      title: "Nightly memory acquisition",
      status: "failed",
      summary: "The build failed because the acquired note had no sourceRef.",
    });

    expect(completedTask).toContainEqual({
      noteKind: "context",
      noteKey: "source-local-vitest-caught-regression-before-broad-gates",
      content: "Source-local Vitest caught the regression before broad gates.",
      sourceRef: "memory-distill:task-run:task-1",
    });
    expect(failedBuild).toContainEqual({
      noteKind: "caution",
      noteKey: "build-failed-because-acquired-note-had-sourceref",
      content: "The build failed because the acquired note had no sourceRef.",
      sourceRef: "memory-distill:build:FB-1",
    });
  });

  it("rejects unsafe doctrine mutations while keeping safety cautions", () => {
    expect(
      shouldRejectMemoryContent("Rewrite the WWMD kernel principle automatically when a coworker learns."),
    ).toBe(true);
    expect(shouldRejectMemoryContent("Auto-mutate founder doctrine from nightly reflection.")).toBe(true);
    expect(shouldRejectMemoryContent("Avoid storing broad conclusions that would mutate WWMD.")).toBe(false);
    expect(shouldRejectMemoryContent("Prefer source-local tests before broad gates.")).toBe(false);
  });

  it("dedupes repeated candidate keys from the same source", () => {
    const notes = distillMemoryNotesFromExperience({
      sourceKind: "phase-handoff",
      sourceId: "handoff-2",
      agentId: "AGT-EA",
      title: "Repeat",
      decisionsMade: [
        "Use source-local Vitest before broad gates.",
        "Use source local Vitest before broad gates!",
      ],
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]?.noteKey).toBe("source-local-vitest-before-broad-gates");
  });
});
