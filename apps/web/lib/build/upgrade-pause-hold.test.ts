// BI-E9DAA23F (live, 2026-10-07): 59 of 126 plan-parked builds last stopped on
// "Waiting for the platform upgrade to finish". Nothing woke them when the
// pause cleared; they waited for the 10-minute resume tick, and a build parked
// that way for a week was aged out as if it had failed on its own.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resumePreBuildPhaseMock } = vi.hoisted(() => ({ resumePreBuildPhaseMock: vi.fn() }));

vi.mock("@/lib/build/resume-pre-build-phase", () => ({
  resumePreBuildPhase: (...args: unknown[]) => resumePreBuildPhaseMock(...args),
}));

import { UPGRADE_WAIT_ACTIVITY_TOOL, recentlyActiveBuildIds } from "./build-liveness";
import {
  findBuildsHeldByUpgradePause,
  isBuildHeldByUpgradePause,
  resumeBuildHeldByUpgradePause,
} from "./upgrade-pause-hold";

type Row = { buildId: string; tool: string; createdAt: Date };

/** A BuildActivity + FeatureBuild fake that answers the queries the module makes. */
function fakeDb(rows: Row[], builds: Array<{ buildId: string; phase: string; abandonedAt?: Date | null; createdById?: string }>) {
  const created: Array<{ buildId: string; tool: string; summary: string }> = [];
  const db = {
    buildActivity: {
      findFirst: vi.fn(async ({ where }: { where: { buildId: string } }) => {
        const mine = rows.filter((r) => r.buildId === where.buildId);
        mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return mine[0] ? { tool: mine[0].tool, createdAt: mine[0].createdAt } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { tool?: string | { notIn: string[] }; createdAt?: { gte: Date }; buildId?: { in: string[] } } }) => {
        return rows.filter((r) => {
          if (typeof where.tool === "string" && r.tool !== where.tool) return false;
          if (where.tool && typeof where.tool === "object" && where.tool.notIn.includes(r.tool)) return false;
          if (where.createdAt && r.createdAt < where.createdAt.gte) return false;
          if (where.buildId && !where.buildId.in.includes(r.buildId)) return false;
          return true;
        });
      }),
      create: vi.fn(async ({ data }: { data: { buildId: string; tool: string; summary: string } }) => {
        created.push(data);
        rows.push({ ...data, createdAt: new Date() });
        return data;
      }),
    },
    featureBuild: {
      findMany: vi.fn(async ({ where }: { where: { buildId: { in: string[] } } }) =>
        builds
          .filter((b) => where.buildId.in.includes(b.buildId))
          .map((b) => ({ abandonedAt: null, createdById: "user-1", ...b })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { buildId: string } }) => {
        const b = builds.find((x) => x.buildId === where.buildId);
        return b ? { abandonedAt: null, createdById: "user-1", ...b } : null;
      }),
    },
  };
  return { db, created };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeEach(() => {
  resumePreBuildPhaseMock.mockReset();
  resumePreBuildPhaseMock.mockResolvedValue({ kind: "resumed", phase: "plan", via: "performPlanToBuildTransition", detail: "advanced plan → build" });
});

describe("a build is held by the upgrade pause only while the wait is the last thing that happened to it", () => {
  it("is held when its latest activity is the upgrade-wait marker", async () => {
    const { db } = fakeDb(
      [
        { buildId: "FB-1", tool: "reviewBuildPlan", createdAt: minutesAgo(30) },
        { buildId: "FB-1", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(5) },
      ],
      [],
    );
    expect(await isBuildHeldByUpgradePause(db as never, "FB-1")).toBe(true);
  });

  it("is not held once an attempt made after the wait recorded its own outcome (a gate, not the platform)", async () => {
    const { db } = fakeDb(
      [
        { buildId: "FB-2", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(30) },
        { buildId: "FB-2", tool: "resumeStrandedBuildsOnBoot", createdAt: minutesAgo(20) },
      ],
      [],
    );
    expect(await isBuildHeldByUpgradePause(db as never, "FB-2")).toBe(false);
  });

  it("is not held when it never waited on an upgrade", async () => {
    const { db } = fakeDb([{ buildId: "FB-3", tool: "reviewBuildPlan", createdAt: minutesAgo(5) }], []);
    expect(await isBuildHeldByUpgradePause(db as never, "FB-3")).toBe(false);
  });
});

describe("the upgrade-wait marker is not progress", () => {
  it("does not make a waiting build look live to the stranded-build resumer", async () => {
    const db = { buildActivity: { findMany: vi.fn().mockResolvedValue([]) } };
    await recentlyActiveBuildIds(db as never, ["FB-W"], new Date());
    const where = db.buildActivity.findMany.mock.calls[0]![0].where as { tool: { notIn: string[] } };
    expect(where.tool.notIn).toContain(UPGRADE_WAIT_ACTIVITY_TOOL);
  });
});

describe("findBuildsHeldByUpgradePause", () => {
  it("returns pre-build builds still held by a recent wait, and nothing else", async () => {
    const { db } = fakeDb(
      [
        { buildId: "FB-HELD", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(3) },
        { buildId: "FB-MOVED-ON", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(9) },
        { buildId: "FB-MOVED-ON", tool: "resumeStrandedBuildsOnBoot", createdAt: minutesAgo(2) },
        { buildId: "FB-ABANDONED", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(3) },
        { buildId: "FB-SHIPPED", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(3) },
        { buildId: "FB-NEVER-WAITED", tool: "reviewBuildPlan", createdAt: minutesAgo(3) },
      ],
      [
        { buildId: "FB-HELD", phase: "plan" },
        { buildId: "FB-MOVED-ON", phase: "plan" },
        { buildId: "FB-ABANDONED", phase: "abandoned", abandonedAt: new Date() },
        { buildId: "FB-SHIPPED", phase: "ship" },
        { buildId: "FB-NEVER-WAITED", phase: "plan" },
      ],
    );
    const held = await findBuildsHeldByUpgradePause({ db: db as never });
    expect(held).toEqual([{ buildId: "FB-HELD", phase: "plan", userId: "user-1" }]);
  });
});

describe("resumeBuildHeldByUpgradePause", () => {
  it("re-fires the canonical pre-build resume and records the outcome", async () => {
    const { db, created } = fakeDb([{ buildId: "FB-HELD", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(3) }], [
      { buildId: "FB-HELD", phase: "plan" },
    ]);
    const outcome = await resumeBuildHeldByUpgradePause({ buildId: "FB-HELD", db: db as never });
    expect(outcome).toBe("resumed");
    expect(resumePreBuildPhaseMock).toHaveBeenCalledWith({ buildId: "FB-HELD", phase: "plan", userId: "user-1" });
    expect(created.map((c) => c.tool)).toEqual(["resumeBuildsAfterUpgradePause", "resumeBuildsAfterUpgradePause"]);
  });

  it("leaves a build alone once something else moved it on", async () => {
    const { db } = fakeDb(
      [
        { buildId: "FB-X", tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: minutesAgo(9) },
        { buildId: "FB-X", tool: "resumeStrandedBuildsOnBoot", createdAt: minutesAgo(1) },
      ],
      [{ buildId: "FB-X", phase: "plan" }],
    );
    expect(await resumeBuildHeldByUpgradePause({ buildId: "FB-X", db: db as never })).toBe("not-held");
    expect(resumePreBuildPhaseMock).not.toHaveBeenCalled();
  });
});
