import { describe, expect, it, vi } from "vitest";
import { countAttributedWork, createPrismaWorkAttributionStore, type WorkAttributionStore } from "./work-attribution";

function store(counts: Partial<Record<keyof WorkAttributionStore, number>> = {}): WorkAttributionStore {
  return {
    countActiveFeatureBuilds: vi.fn(async () => counts.countActiveFeatureBuilds ?? 0),
    countActiveTaskRuns: vi.fn(async () => counts.countActiveTaskRuns ?? 0),
    countActiveWorkCapsules: vi.fn(async () => counts.countActiveWorkCapsules ?? 0),
  };
}

describe("runtime work attribution", () => {
  it("queries every declared guard and reports only its exact blocking count", async () => {
    const db = store({ countActiveFeatureBuilds: 2, countActiveTaskRuns: 3, countActiveWorkCapsules: 4 });
    const result = await countAttributedWork([
      "build-studio-active", "task-run:build", "work-capsule:build-studio",
    ], db);
    expect(result).toEqual({
      total: 9,
      blockingCounts: {
        "build-studio-active": 2,
        "task-run:build": 3,
        "work-capsule:build-studio": 4,
      },
    });
    expect(db.countActiveFeatureBuilds).toHaveBeenCalledOnce();
    expect(db.countActiveTaskRuns).toHaveBeenCalledWith("build", ["submitted", "working", "input-required", "auth-required", "quiescing"]);
    expect(db.countActiveWorkCapsules).toHaveBeenCalledWith("build-studio", ["claimed", "working", "review", "blocked"]);
  });

  it("does not invent blockers for unrelated sources or terminal states", async () => {
    const db = store();
    const result = await countAttributedWork(["task-run:build"], db);
    expect(result.total).toBe(0);
    expect(db.countActiveWorkCapsules).not.toHaveBeenCalled();
  });

  it("rejects unknown guards before querying storage", async () => {
    const db = store();
    await expect(countAttributedWork(["task-run:build", "raw-prisma-filter"], db)).rejects.toThrow("invalid_runtime_work_guard:raw-prisma-filter");
    expect(db.countActiveTaskRuns).not.toHaveBeenCalled();
  });

  it("binds guards to closed equality/state filters rather than caller-provided Prisma", async () => {
    const prisma = {
      featureBuild: { count: vi.fn(async () => 1) },
      taskRun: { count: vi.fn(async () => 2) },
      workCapsule: { count: vi.fn(async () => 3) },
    };
    const db = createPrismaWorkAttributionStore(prisma);
    await Promise.all([
      db.countActiveFeatureBuilds(),
      db.countActiveTaskRuns("build", ["working"]),
      db.countActiveWorkCapsules("build-studio", ["blocked"]),
    ]);
    expect(prisma.featureBuild.count).toHaveBeenCalledWith({ where: { abandonedAt: null, phase: { in: ["ideate", "plan", "build", "review"] } } });
    expect(prisma.taskRun.count).toHaveBeenCalledWith({ where: { source: "build", status: { in: ["working"] } } });
    expect(prisma.workCapsule.count).toHaveBeenCalledWith({ where: { source: "build-studio", status: { in: ["blocked"] } } });
  });
});
