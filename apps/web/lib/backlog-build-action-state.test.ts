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

  it("offers Rebuild (a fresh draft) for an abandoned dead draft instead of resuming the corpse", () => {
    // BI-99D896CF: an abandoned build is a dead draft — resuming it re-strands.
    // startBacklogBuild (BI-08AE51DC) detaches it and promotes a fresh draft, so
    // the row must offer a Rebuild action, not a Resume link into the corpse.
    expect(resolveBacklogBuildActionState({
      ...baseItem,
      activeBuildId: "feature-build-row-1",
      activeBuild: { buildId: "FB-DEAD0001", phase: "abandoned" },
    })).toEqual({
      kind: "rebuild",
      label: "Rebuild",
      href: null,
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
