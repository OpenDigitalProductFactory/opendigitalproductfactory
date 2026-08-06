import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({
  revalidatePortalContext: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    workCapsule: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    workCapsuleActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

import {
  reapStaleWorkCapsules,
  selectReapCandidates,
  transitionCapsuleForTerminalBuild,
  type ReaperBuildSnapshot,
} from "./work-capsule-reaper";
import type { CapsuleDb } from "./work-capsule-store";

const NOW = new Date("2026-08-05T15:00:00.000Z");

function capsule(overrides: Record<string, unknown> = {}) {
  return {
    capsuleId: "WC-X",
    title: "Something",
    status: "working",
    source: "build-studio",
    executorKind: "build-studio",
    leaseExpiresAt: null,
    lastSyncedAt: null,
    updatedAt: NOW,
    pullRequestUrl: null,
    pullRequestNumber: null,
    headBranch: null,
    worktreePath: null,
    featureBuildId: null,
    ...overrides,
  };
}

describe("selectReapCandidates", () => {
  it("selects lease-expired, build-terminal, and idle-stale — never live/terminal", () => {
    const builds = new Map<string, ReaperBuildSnapshot>([
      ["fb-abandoned", { phase: "abandoned", lastActivityAt: new Date("2026-08-02T09:00:00.000Z") }],
      ["fb-building", { phase: "build", lastActivityAt: new Date("2026-08-05T14:55:00.000Z") }],
    ]);
    const rows = [
      capsule({ capsuleId: "WC-LEASE-DEAD", executorKind: "codex-desktop", leaseExpiresAt: new Date("2026-08-01T00:00:00.000Z") }),
      capsule({ capsuleId: "WC-LEASE-LIVE", executorKind: "codex-desktop", leaseExpiresAt: new Date("2026-08-05T15:20:00.000Z") }),
      capsule({ capsuleId: "WC-ZOMBIE", featureBuildId: "fb-abandoned" }),
      capsule({ capsuleId: "WC-BUILDING", featureBuildId: "fb-building" }),
      capsule({ capsuleId: "WC-FROZEN14", updatedAt: new Date("2026-08-02T14:00:00.000Z") }),
      capsule({ capsuleId: "WC-PR", pullRequestNumber: 4055, leaseExpiresAt: new Date("2026-08-01T00:00:00.000Z") }),
      capsule({ capsuleId: "WC-DONE", status: "complete", updatedAt: new Date("2026-06-01T00:00:00.000Z") }),
      capsule({ capsuleId: "WC-NEW", updatedAt: new Date("2026-08-05T14:45:00.000Z") }),
    ];

    const picked = selectReapCandidates(rows, builds, NOW).map((c) => c.capsuleId);

    expect(picked).toEqual(["WC-LEASE-DEAD", "WC-ZOMBIE", "WC-FROZEN14"]);
    expect(picked).not.toContain("WC-LEASE-LIVE");
    expect(picked).not.toContain("WC-BUILDING");
    expect(picked).not.toContain("WC-PR");
    expect(picked).not.toContain("WC-DONE");
    expect(picked).not.toContain("WC-NEW");
  });
});

function makeDb() {
  const db = {
    workCapsule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    workCapsuleActivity: { create: vi.fn() },
    featureBuild: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

describe("reapStaleWorkCapsules", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  const deadRows = () => [
    capsule({ capsuleId: "WC-LEASE-DEAD", executorKind: "codex-desktop", leaseExpiresAt: new Date("2026-08-01T00:00:00.000Z") }),
    capsule({ capsuleId: "WC-LIVE", executorKind: "codex-desktop", leaseExpiresAt: new Date("2026-08-05T15:30:00.000Z") }),
  ];

  it("DEFAULTS to dry-run: returns candidates but writes nothing", async () => {
    db.workCapsule.findMany.mockResolvedValueOnce(deadRows());
    db.featureBuild.findMany.mockResolvedValueOnce([]);

    const result = await reapStaleWorkCapsules({ db: db as unknown as CapsuleDb, now: NOW });

    expect(result.dryRun).toBe(true);
    expect(result.reaped).toBe(0);
    expect(result.candidates.map((c) => c.capsuleId)).toEqual(["WC-LEASE-DEAD"]);
    // No mutation on the default path.
    expect(db.workCapsule.update).not.toHaveBeenCalled();
    expect(db.workCapsuleActivity.create).not.toHaveBeenCalled();
  });

  it("transitions dead capsules to abandoned only when dryRun=false", async () => {
    db.workCapsule.findMany.mockResolvedValueOnce(deadRows());
    db.featureBuild.findMany.mockResolvedValueOnce([]);
    db.workCapsule.findUnique.mockResolvedValue({ id: "row-lease-dead", capsuleId: "WC-LEASE-DEAD", workspaceState: {} });
    db.workCapsule.update.mockResolvedValue({ id: "row-lease-dead", capsuleId: "WC-LEASE-DEAD" });

    const result = await reapStaleWorkCapsules({ db: db as unknown as CapsuleDb, now: NOW, dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.reaped).toBe(1);
    expect(db.workCapsule.update).toHaveBeenCalledTimes(1);
    expect(db.workCapsule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capsuleId: "WC-LEASE-DEAD" },
        data: expect.objectContaining({ status: "abandoned" }),
      }),
    );
    // The live capsule is never touched.
    expect(db.workCapsule.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { capsuleId: "WC-LIVE" } }),
    );
  });

  it("classifies zombie build-studio capsules via the linked build snapshot", async () => {
    db.workCapsule.findMany.mockResolvedValueOnce([
      capsule({ capsuleId: "WC-ZOMBIE", featureBuildId: "fb-1" }),
    ]);
    db.featureBuild.findMany.mockResolvedValueOnce([
      { id: "fb-1", phase: "abandoned", updatedAt: new Date("2026-08-02T09:00:00.000Z") },
    ]);

    const result = await reapStaleWorkCapsules({ db: db as unknown as CapsuleDb, now: NOW });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.liveness).toBe("build-terminal");
  });
});

describe("transitionCapsuleForTerminalBuild (build-reap coupling)", () => {
  beforeEach(() => {
    prismaMock.workCapsule.findFirst.mockReset();
    prismaMock.workCapsule.findUnique.mockReset();
    prismaMock.workCapsule.update.mockReset();
    prismaMock.workCapsuleActivity.create.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
  });

  it("abandons the non-terminal capsule attached to a reaped build", async () => {
    prismaMock.workCapsule.findFirst.mockResolvedValueOnce({ capsuleId: "WC-ZOMBIE" });
    prismaMock.workCapsule.findUnique.mockResolvedValueOnce({ id: "row-z", capsuleId: "WC-ZOMBIE", workspaceState: {} });
    prismaMock.workCapsule.update.mockResolvedValueOnce({ id: "row-z", capsuleId: "WC-ZOMBIE" });

    const did = await transitionCapsuleForTerminalBuild("FB-123", "inert — no activity in ideate.");

    expect(did).toBe(true);
    // Looks up by the build-studio idempotency key and only when non-terminal.
    expect(prismaMock.workCapsule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ idempotencyKey: "build-studio:FB-123" }),
      }),
    );
    expect(prismaMock.workCapsule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "abandoned" }) }),
    );
  });

  it("is a no-op when no attached non-terminal capsule exists", async () => {
    prismaMock.workCapsule.findFirst.mockResolvedValueOnce(null);

    const did = await transitionCapsuleForTerminalBuild("FB-404", "stalled.");

    expect(did).toBe(false);
    expect(prismaMock.workCapsule.update).not.toHaveBeenCalled();
  });
});
