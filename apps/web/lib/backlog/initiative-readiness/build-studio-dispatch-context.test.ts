import { describe, expect, it, vi } from "vitest";

import {
  BUILD_STUDIO_DISPATCH_ROOM_SELECT,
  resolveBuildStudioDispatch,
  resolveBuildStudioDispatchContext,
  type BuildStudioDispatchRoom,
} from "./build-studio-dispatch-context";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

function room(overrides: Partial<BuildStudioDispatchRoom> = {}): BuildStudioDispatchRoom {
  return {
    capsuleId: "WC-BUILD1",
    executorKind: "build-studio",
    repositoryFullName: null,
    headSha: null,
    featureBuild: {
      buildId: "FB-1",
      phase: "plan",
      originator: { itemId: "BI-1" },
      artifactRevisions: [
        { id: "rev_design_3", field: "designDoc", valueDigest: "sha256:design3" },
        { id: "rev_plan_2", field: "buildPlan", valueDigest: "plan2" },
        { id: "rev_design_2", field: "designDoc", valueDigest: "sha256:design2" },
      ],
    },
    ...overrides,
  };
}

describe("resolveBuildStudioDispatch (BI-926A7E90 PR-2)", () => {
  it("binds the newest accepted design revision and keys the context on its digest when the room has no head", () => {
    const result = resolveBuildStudioDispatch(room(), REPO);
    expect(result).toEqual({
      available: true,
      buildId: "FB-1",
      itemId: "BI-1",
      dispatchContext: { workroomId: "WC-BUILD1", repositoryFullName: REPO, branchName: "build/FB-1", headSha: "sha256:design3" },
      canonicalArtifact: { resolved: true, kind: "feature-build-revision", revisionId: "rev_design_3", valueDigest: "sha256:design3", buildId: "FB-1" },
      planArtifact: { resolved: true, kind: "feature-build-revision", revisionId: "rev_plan_2", valueDigest: "plan2", buildId: "FB-1" },
    });
  });

  it("prefers the room's own repository and sandbox head when recorded", () => {
    const result = resolveBuildStudioDispatch(room({ repositoryFullName: "other/repo", headSha: "a".repeat(40) }), REPO);
    expect(result).toMatchObject({ dispatchContext: { repositoryFullName: "other/repo", headSha: "a".repeat(40) } });
  });

  it("a changed design changes the immutable identity (AC-4)", () => {
    const before = resolveBuildStudioDispatch(room(), REPO);
    const after = resolveBuildStudioDispatch(room({ featureBuild: { ...room().featureBuild!, artifactRevisions: [
      { id: "rev_design_4", field: "designDoc", valueDigest: "sha256:design4" },
      ...room().featureBuild!.artifactRevisions,
    ] } }), REPO);
    expect(before.available && after.available && before.dispatchContext.headSha !== after.dispatchContext.headSha).toBe(true);
  });

  it("names each unavailable reason", () => {
    expect(resolveBuildStudioDispatch(null, REPO)).toEqual({ available: false, reason: "room-not-found" });
    expect(resolveBuildStudioDispatch(room({ executorKind: "claude-desktop" }), REPO)).toEqual({ available: false, reason: "not-a-build-studio-room" });
    expect(resolveBuildStudioDispatch(room({ featureBuild: null }), REPO)).toEqual({ available: false, reason: "no-build" });
    expect(resolveBuildStudioDispatch(room({ featureBuild: { ...room().featureBuild!, phase: "build" } }), REPO)).toEqual({ available: false, reason: "not-in-plan" });
    expect(resolveBuildStudioDispatch(room({ featureBuild: { ...room().featureBuild!, artifactRevisions: [
      { id: "rev_plan_2", field: "buildPlan", valueDigest: "plan2" },
    ] } }), REPO)).toEqual({ available: false, reason: "no-accepted-design" });
  });

  it("loads the room with the shared select and resolves the repository lazily", async () => {
    const findUnique = vi.fn().mockResolvedValue(room());
    const canonicalRepositoryFullName = vi.fn().mockResolvedValue(REPO);
    const result = await resolveBuildStudioDispatchContext({
      db: { workroom: { findUnique } },
      capsuleId: "WC-BUILD1",
      canonicalRepositoryFullName,
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { capsuleId: "WC-BUILD1" }, select: BUILD_STUDIO_DISPATCH_ROOM_SELECT });
    expect(canonicalRepositoryFullName).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ available: true, buildId: "FB-1" });
    findUnique.mockResolvedValue(null);
    expect(await resolveBuildStudioDispatchContext({ db: { workroom: { findUnique } }, capsuleId: "WC-NONE", canonicalRepositoryFullName }))
      .toEqual({ available: false, reason: "room-not-found" });
  });
});
