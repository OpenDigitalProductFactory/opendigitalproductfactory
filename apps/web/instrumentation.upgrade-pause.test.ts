// BI-E9DAA23F: how the stranded-build resumer treats builds an upgrade pause is
// holding. Split from instrumentation.test.ts, which is at its size baseline.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { featureBuildFindManyMock, buildActivityFindFirstMock, getQuiescenceLevelMock } = vi.hoisted(() => ({
  featureBuildFindManyMock: vi.fn(),
  buildActivityFindFirstMock: vi.fn(),
  getQuiescenceLevelMock: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceLevel: () => getQuiescenceLevelMock(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findMany: (...a: unknown[]) => featureBuildFindManyMock(...a) },
    buildActivity: {
      create: async () => ({}),
      findMany: async () => [],
      findFirst: (...a: unknown[]) => buildActivityFindFirstMock(...a),
    },
  },
  Prisma: { DbNull: { __dbnull: true }, JsonNull: { __jsonnull: true } },
}));

import { resumeStrandedBuildsOnBoot } from "./instrumentation";

const quiet = { log: vi.fn(), error: vi.fn() };
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
const strand = (buildId: string, phase: string, createdAt: Date, extra: Record<string, unknown> = {}) => ({
  buildId,
  phase,
  buildExecState: null,
  verificationOut: null,
  createdById: "u",
  createdAt,
  parentEpicId: null,
  ...extra,
});

beforeEach(() => {
  featureBuildFindManyMock.mockReset();
  buildActivityFindFirstMock.mockReset().mockResolvedValue(null);
  getQuiescenceLevelMock.mockReset().mockResolvedValue("normal");
});

describe("resumeStrandedBuildsOnBoot and the upgrade pause (BI-E9DAA23F)", () => {
  // AC-2: a build parked by upgrade pauses is held by the platform, not failing
  // on its own; the 7-day age-out must not retire it.
  it("does not age out a stale pre-build strand whose last activity is the upgrade-pause wait", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([strand("BLD-HELD", "plan", daysAgo(20))]);
    buildActivityFindFirstMock.mockResolvedValue({ tool: "phase:upgrade-wait", createdAt: new Date(Date.now() - 30 * 60_000) });
    const resumePreBuild = vi.fn();
    const abandonStale = vi.fn().mockResolvedValue(true);

    const result = await resumeStrandedBuildsOnBoot({ dispatch: vi.fn(), resumePreBuild, abandonStale }, quiet);

    expect(abandonStale).not.toHaveBeenCalled();
    expect(resumePreBuild).toHaveBeenCalledWith({ buildId: "BLD-HELD", phase: "plan", userId: "u" });
    expect(result).toEqual({ resumed: 0, flagged: 1, advanced: 0, abandoned: 0 });
  });

  it("still ages out a stale strand whose last attempt after a wait was refused for its own reason", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([strand("BLD-GATED", "plan", daysAgo(20))]);
    // The wait happened, then a later resume recorded a gate refusal.
    buildActivityFindFirstMock.mockResolvedValue({ tool: "resumeStrandedBuildsOnBoot", createdAt: new Date() });
    const abandonStale = vi.fn().mockResolvedValue(true);

    const result = await resumeStrandedBuildsOnBoot({ dispatch: vi.fn(), resumePreBuild: vi.fn(), abandonStale }, quiet);

    expect(abandonStale).toHaveBeenCalledWith(expect.objectContaining({ buildId: "BLD-GATED", phase: "plan" }));
    expect(result).toEqual({ resumed: 0, flagged: 0, advanced: 0, abandoned: 1 });
  });

  // A pre-build resume during a pause only records another wait, and would make
  // the platform look like the build's own blocker. Wait for the clear; the
  // build-phase step-machine resume is unchanged.
  it("neither resumes nor ages out pre-build strands while an upgrade pause is in force", async () => {
    getQuiescenceLevelMock.mockResolvedValue("draining");
    featureBuildFindManyMock.mockResolvedValueOnce([
      strand("BLD-OLD-IDEATE", "ideate", daysAgo(20)),
      strand("BLD-PLAN", "plan", new Date()),
      strand("BLD-BUILD", "build", new Date(), { buildExecState: { step: "deps_installed" } }),
    ]);
    const dispatch = vi.fn();
    const resumePreBuild = vi.fn();
    const abandonStale = vi.fn().mockResolvedValue(true);

    const result = await resumeStrandedBuildsOnBoot({ dispatch, resumePreBuild, abandonStale }, quiet);

    expect(resumePreBuild).not.toHaveBeenCalled();
    expect(abandonStale).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith("BLD-BUILD");
    expect(result).toEqual({ resumed: 1, flagged: 0, advanced: 0, abandoned: 0 });
  });
});
