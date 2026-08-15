import { describe, expect, it, vi } from "vitest";
import {
  ASSURANCE_REMEDIATION_COOLDOWN_DAYS,
  createLiveMergeGateAdapters,
  fetchOsvClean,
  fetchReleaseCooldownMet,
  isReleaseAgedEnough,
  mapMergeStateToReadiness,
  osvBatchClean,
  parseObservedPackage,
  parseRemediationVersions,
} from "./remediation-merge-live";

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("mapMergeStateToReadiness", () => {
  it("treats only 'clean' as green and 'dirty' as a conflict", () => {
    expect(mapMergeStateToReadiness("clean")).toEqual({ ciGreen: true, hasConflict: false });
    expect(mapMergeStateToReadiness("dirty")).toEqual({ ciGreen: false, hasConflict: true });
    for (const s of ["blocked", "unstable", "behind", null]) {
      expect(mapMergeStateToReadiness(s)).toEqual({ ciGreen: false, hasConflict: false });
    }
  });
});

describe("parse helpers", () => {
  it("parseRemediationVersions extracts from/to", () => {
    expect(parseRemediationVersions("Observed: hono@4.12.19\nPatched: >=4.12.25")).toEqual({
      from: "4.12.19",
      to: "4.12.25",
    });
  });

  it("parseObservedPackage extracts the package name (incl. scope)", () => {
    expect(parseObservedPackage("Observed: hono@4.12.19")).toBe("hono");
    expect(parseObservedPackage("Observed: @babel/core@7.29.0")).toBe("@babel/core");
    expect(parseObservedPackage("no observed line")).toBeNull();
  });
});

describe("isReleaseAgedEnough", () => {
  const now = new Date("2026-06-23T00:00:00.000Z");
  it("is true only when the publish date is at least minDays old", () => {
    expect(isReleaseAgedEnough("2026-06-10T00:00:00.000Z", now, ASSURANCE_REMEDIATION_COOLDOWN_DAYS)).toBe(true);
    expect(isReleaseAgedEnough("2026-06-22T12:00:00.000Z", now, ASSURANCE_REMEDIATION_COOLDOWN_DAYS)).toBe(false);
  });
  it("is false for unknown/invalid dates", () => {
    expect(isReleaseAgedEnough(null, now, 3)).toBe(false);
    expect(isReleaseAgedEnough("not-a-date", now, 3)).toBe(false);
  });
});

describe("osvBatchClean", () => {
  it("is clean only when a result is present with no vulns", () => {
    expect(osvBatchClean({ results: [{}] })).toBe(true);
    expect(osvBatchClean({ results: [{ vulns: [] }] })).toBe(true);
    expect(osvBatchClean({ results: [{ vulns: [{ id: "GHSA-x" }] }] })).toBe(false);
    expect(osvBatchClean({ results: [] })).toBe(false);
    expect(osvBatchClean({})).toBe(false);
  });
});

describe("fetchReleaseCooldownMet", () => {
  const now = new Date("2026-06-23T00:00:00.000Z");
  it("returns true when the bumped version is aged past the cooldown", async () => {
    const fetchImpl = vi.fn(async () => okJson({ time: { "4.12.25": "2026-06-01T00:00:00.000Z" } }));
    expect(await fetchReleaseCooldownMet(fetchImpl as never, "hono", "4.12.25", now)).toBe(true);
  });
  it("returns false for a too-fresh release, missing inputs, or a bad response", async () => {
    const fresh = vi.fn(async () => okJson({ time: { "4.12.25": "2026-06-22T20:00:00.000Z" } }));
    expect(await fetchReleaseCooldownMet(fresh as never, "hono", "4.12.25", now)).toBe(false);
    expect(await fetchReleaseCooldownMet(fresh as never, null, "4.12.25", now)).toBe(false);
    const bad = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    expect(await fetchReleaseCooldownMet(bad as never, "hono", "4.12.25", now)).toBe(false);
  });
  it("encodes scoped package names for the registry path", async () => {
    const fetchImpl = vi.fn(async () => okJson({ time: { "7.29.6": "2026-01-01T00:00:00.000Z" } }));
    await fetchReleaseCooldownMet(fetchImpl as never, "@babel/core", "7.29.6", now);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("@babel%2Fcore"), expect.anything());
  });
});

describe("fetchOsvClean", () => {
  it("returns true when OSV reports no vulns for the bump target", async () => {
    const fetchImpl = vi.fn(async () => okJson({ results: [{}] }));
    expect(await fetchOsvClean(fetchImpl as never, "hono", "4.12.25")).toBe(true);
  });
  it("returns false when OSV reports a vuln or the request fails", async () => {
    const vuln = vi.fn(async () => okJson({ results: [{ vulns: [{ id: "GHSA-x" }] }] }));
    expect(await fetchOsvClean(vuln as never, "hono", "4.12.25")).toBe(false);
    const bad = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    expect(await fetchOsvClean(bad as never, "hono", "4.12.25")).toBe(false);
  });
});

describe("createLiveMergeGateAdapters.listReadyRemediationPRs", () => {
  it("joins assurance BIs → build → capsule PR, with the package name", async () => {
    const prisma = {
      backlogItem: {
        findMany: async () => [
          { itemId: "BI-1", title: "Remediate hono", body: "Observed: hono@4.12.19\nPatched: >=4.12.25\n[origin:assuranceFinding:fk]", activeBuildId: "cuid-b1" },
        ],
      },
      workroom: { findMany: async () => [{ featureBuildId: "cuid-b1", pullRequestNumber: 123, pullRequestUrl: "https://gh/pr/123" }] },
      featureBuild: { findMany: async () => [{ id: "cuid-b1", buildId: "FB-1" }] },
    };
    const adapters = await createLiveMergeGateAdapters({ prisma: prisma as never, actuationEnabled: false });
    expect(await adapters.listReadyRemediationPRs()).toEqual([
      {
        buildId: "FB-1",
        buildPk: "cuid-b1",
        backlogItemId: "BI-1",
        prNumber: 123,
        title: "Remediate hono",
        packageName: "hono",
        fromVersion: "4.12.19",
        toVersion: "4.12.25",
      },
    ]);
  });
});

describe("createLiveMergeGateAdapters.armAutoMerge (P2.2b)", () => {
  const pr = {
    buildId: "FB-1",
    buildPk: "cuid-b1",
    backlogItemId: "BI-1",
    prNumber: 123,
    title: "Remediate hono",
    packageName: "hono",
    fromVersion: "4.12.19",
    toVersion: "4.12.25",
  };

  function tokenPrisma() {
    return {
      backlogItem: { findMany: async () => [] },
      workroom: { findMany: async () => [] },
      featureBuild: { findMany: async () => [] },
      credentialEntry: { findUnique: async () => ({ secretRef: "ghtok", status: "active" }) },
      platformDevConfig: { findUnique: async () => ({ upstreamRemoteUrl: "https://github.com/o/r" }) },
    };
  }

  it("resolves the PR node id and calls enablePullRequestAutoMerge", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson({ data: { repository: { pullRequest: { id: "PR_NODE_1" } } } }))
      .mockResolvedValueOnce(okJson({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 123 } } } }));

    const adapters = await createLiveMergeGateAdapters({
      prisma: tokenPrisma() as never,
      actuationEnabled: true,
      fetchImpl: fetchImpl as never,
    });
    await expect(adapters.armAutoMerge(pr)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const mutationCall = (fetchImpl.mock.calls[1]![1] as { body: string }).body;
    expect(mutationCall).toContain("enablePullRequestAutoMerge");
    expect(mutationCall).toContain("PR_NODE_1");
  });

  it("throws when no GitHub token is configured", async () => {
    const noToken = {
      ...tokenPrisma(),
      credentialEntry: { findUnique: async () => null },
    };
    const adapters = await createLiveMergeGateAdapters({
      prisma: noToken as never,
      actuationEnabled: true,
      fetchImpl: (vi.fn() as never),
    });
    await expect(adapters.armAutoMerge(pr)).rejects.toThrow(/no GitHub token/i);
  });
});
