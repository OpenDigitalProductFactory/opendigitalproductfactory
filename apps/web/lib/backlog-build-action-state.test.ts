import { describe, expect, it } from "vitest";
import { resolveBacklogBuildActionState } from "@/lib/backlog-build-action-state";

const baseItem = {
  itemId: "BI-123",
  status: "open",
  triageOutcome: "build",
  effortSize: "medium",
  activeBuildId: null,
  activeBuild: null,
};

describe("resolveBacklogBuildActionState", () => {
  it("starts a Build Studio draft for an open build-ready backlog item", () => {
    expect(resolveBacklogBuildActionState(baseItem)).toEqual({
      kind: "start",
      label: "Start build",
      href: null,
      disabled: false,
    });
  });

  it("resumes an existing active build without offering to create a duplicate", () => {
    expect(resolveBacklogBuildActionState({
      ...baseItem,
      activeBuildId: "feature-build-row-1",
      activeBuild: { buildId: "FB-12345678", phase: "build" },
    })).toEqual({
      kind: "resume",
      label: "Resume build",
      href: "/build?buildId=FB-12345678",
      disabled: false,
    });
  });

  it("opens a completed linked build as history", () => {
    expect(resolveBacklogBuildActionState({
      ...baseItem,
      status: "done",
      activeBuildId: "feature-build-row-1",
      activeBuild: { buildId: "FB-12345678", phase: "complete" },
    })).toEqual({
      kind: "open",
      label: "Open build",
      href: "/build?buildId=FB-12345678",
      disabled: false,
    });
  });

  it("blocks rows that have not been triaged for Build Studio", () => {
    expect(resolveBacklogBuildActionState({
      ...baseItem,
      triageOutcome: "runbook",
    })).toEqual({
      kind: "blocked",
      label: "Build blocked",
      href: null,
      disabled: true,
      reason: "Triage outcome must be build.",
    });
  });
});
