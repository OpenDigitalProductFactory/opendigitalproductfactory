import { describe, expect, it } from "vitest";
import {
  createLiveMergeGateAdapters,
  mapMergeStateToReadiness,
  parseRemediationVersions,
} from "./remediation-merge-live";

describe("mapMergeStateToReadiness", () => {
  it("treats only 'clean' as green and 'dirty' as a conflict", () => {
    expect(mapMergeStateToReadiness("clean")).toEqual({ ciGreen: true, hasConflict: false });
    expect(mapMergeStateToReadiness("CLEAN")).toEqual({ ciGreen: true, hasConflict: false });
    expect(mapMergeStateToReadiness("dirty")).toEqual({ ciGreen: false, hasConflict: true });
  });

  it("escalates every other state (not green, not conflict)", () => {
    for (const s of ["blocked", "unstable", "behind", "has_hooks", "unknown", null]) {
      expect(mapMergeStateToReadiness(s)).toEqual({ ciGreen: false, hasConflict: false });
    }
  });
});

describe("parseRemediationVersions", () => {
  it("extracts from/to from an auto-filed remediation body", () => {
    expect(
      parseRemediationVersions("Severity: HIGH\nObserved: hono@4.12.19\nPatched: >=4.12.25\n[origin:assuranceFinding:fk]"),
    ).toEqual({ from: "4.12.19", to: "4.12.25" });
  });

  it("handles scoped package names and bare patched versions", () => {
    expect(parseRemediationVersions("Observed: @babel/core@7.29.0\nPatched: 7.29.6")).toEqual({
      from: "7.29.0",
      to: "7.29.6",
    });
  });

  it("returns nulls when the markers are absent", () => {
    expect(parseRemediationVersions("no version lines here")).toEqual({ from: null, to: null });
    expect(parseRemediationVersions(null)).toEqual({ from: null, to: null });
  });
});

describe("createLiveMergeGateAdapters.listReadyRemediationPRs", () => {
  function prismaWith(bis: unknown[], capsules: unknown[], builds: unknown[]) {
    return {
      backlogItem: { findMany: async () => bis },
      workCapsule: { findMany: async () => capsules },
      featureBuild: { findMany: async () => builds },
    };
  }

  it("joins assurance BIs → build → capsule PR into ready PRs", async () => {
    const prisma = prismaWith(
      [{ itemId: "BI-1", title: "Remediate hono", body: "Observed: hono@4.12.19\nPatched: >=4.12.25\n[origin:assuranceFinding:fk]", activeBuildId: "cuid-b1" }],
      [{ featureBuildId: "cuid-b1", pullRequestNumber: 123, pullRequestUrl: "https://gh/pr/123" }],
      [{ id: "cuid-b1", buildId: "FB-1" }],
    );
    const adapters = await createLiveMergeGateAdapters({ prisma: prisma as never, actuationEnabled: false });
    expect(await adapters.listReadyRemediationPRs()).toEqual([
      {
        buildId: "FB-1",
        buildPk: "cuid-b1",
        backlogItemId: "BI-1",
        prNumber: 123,
        title: "Remediate hono",
        fromVersion: "4.12.19",
        toVersion: "4.12.25",
      },
    ]);
  });

  it("excludes BIs whose build has no captured PR", async () => {
    const prisma = prismaWith(
      [{ itemId: "BI-2", title: "x", body: "[origin:assuranceFinding:fk]", activeBuildId: "cuid-b2" }],
      [], // no capsule PR
      [{ id: "cuid-b2", buildId: "FB-2" }],
    );
    const adapters = await createLiveMergeGateAdapters({ prisma: prisma as never, actuationEnabled: false });
    expect(await adapters.listReadyRemediationPRs()).toEqual([]);
  });
});

describe("createLiveMergeGateAdapters.armAutoMerge", () => {
  it("throws — actuation is not implemented (hard backstop against early enable)", async () => {
    const prisma = {
      backlogItem: { findMany: async () => [] },
      workCapsule: { findMany: async () => [] },
      featureBuild: { findMany: async () => [] },
    };
    const adapters = await createLiveMergeGateAdapters({ prisma: prisma as never, actuationEnabled: true });
    await expect(
      adapters.armAutoMerge({
        buildId: "FB-1",
        buildPk: "cuid-b1",
        backlogItemId: "BI-1",
        prNumber: 1,
        title: "x",
        fromVersion: "1.0.0",
        toVersion: "1.0.1",
      }),
    ).rejects.toThrow(/not implemented/i);
  });
});
