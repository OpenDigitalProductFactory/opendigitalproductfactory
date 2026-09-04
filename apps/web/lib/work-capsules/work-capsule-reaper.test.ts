import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal-context/invalidation", () => ({
  revalidatePortalContext: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    workroom: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    workroomActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

import {
  annotateDeliveredSignals,
  reconcileTerminalCapsuleBacklogs,
  reapStaleWorkCapsules,
  planTerminalBacklogReconciliation,
  selectReapCandidates,
  transitionCapsuleForTerminalBuild,
  type ReaperBuildSnapshot,
} from "./work-capsule-reaper";
import type { CapsuleDb } from "./work-capsule-store";

const NOW = new Date("2026-08-05T15:00:00.000Z");

describe("planTerminalBacklogReconciliation (BI-C2EB2C6B)", () => {
  it("reopens abandoned in-progress work and clears stale execution links", () => {
    expect(planTerminalBacklogReconciliation({
      backlogStatus: "in-progress",
      activeBuildId: "fb-1",
      buildPhase: "abandoned",
      capsuleStatus: "abandoned",
      hasCompletionEvidence: false,
    })).toEqual(expect.objectContaining({
      targetStatus: "open",
      clearActiveBuild: true,
      releaseClaim: true,
      outcome: "retryable",
    }));
  });

  it("never silently marks a complete execution done without governed evidence", () => {
    const planned = planTerminalBacklogReconciliation({
      backlogStatus: "in-progress",
      activeBuildId: "fb-1",
      buildPhase: "complete",
      capsuleStatus: "complete",
      hasCompletionEvidence: false,
    });
    expect(planned).toMatchObject({
      targetStatus: null,
      clearActiveBuild: true,
      outcome: "awaiting-governed-completion",
      completionEvidenceRequired: true,
    });
  });

  it("is an idempotent no-op once terminal links are reconciled", () => {
    expect(planTerminalBacklogReconciliation({
      backlogStatus: "open",
      activeBuildId: null,
      buildPhase: "abandoned",
      capsuleStatus: "abandoned",
      hasCompletionEvidence: false,
    })).toMatchObject({ changed: false });
  });
});

describe("reconcileTerminalCapsuleBacklogs (BI-C2EB2C6B)", () => {
  it("repairs a terminal abandoned capsule without inferring completion", async () => {
    const db = {
      workroom: {
        findMany: vi.fn().mockResolvedValue([{ capsuleId: "WC-DEAD", status: "abandoned", backlogItemId: "BI-DEAD", featureBuildId: "FB-DEAD" }]),
      },
      featureBuild: {
        findMany: vi.fn().mockResolvedValue([{ id: "FB-DEAD", phase: "abandoned" }]),
      },
      backlogItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "row-bi", itemId: "BI-DEAD", status: "in-progress", activeBuildId: "FB-DEAD" }),
        update: vi.fn().mockResolvedValue({}),
      },
      backlogItemActivity: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
    };

    const result = await reconcileTerminalCapsuleBacklogs({
      db: db as never,
      dryRun: false,
      now: NOW,
    });

    expect(result).toEqual({ scanned: 1, reconciled: 1 });
    expect(db.backlogItem.update).toHaveBeenCalledWith({
      where: { id: "row-bi" },
      data: { activeBuildId: null, status: "open", claimStatus: "released" },
    });
    expect(db.backlogItemActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        backlogItemId: "row-bi",
        kind: "execution_reconciled",
        payload: expect.objectContaining({ rule: "terminal execution never infers backlog done" }),
      }),
    }));
  });
});

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
    headSha: null,
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

  it("tags each candidate's disposition: merged → delivered, dead+unmerged → abandoned", () => {
    const rows = [
      capsule({ capsuleId: "WC-DEAD", executorKind: "codex-desktop", leaseExpiresAt: new Date("2026-08-01T00:00:00.000Z") }),
      capsule({
        capsuleId: "WC-MERGED",
        executorKind: "grok-cli",
        leaseExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
        deliveredSignal: { merged: true }, // caller-computed from local git reachability
      }),
    ];
    const picked = selectReapCandidates(rows, new Map(), NOW);
    const byId = Object.fromEntries(picked.map((c) => [c.capsuleId, c]));
    expect(byId["WC-DEAD"].disposition).toBe("abandoned");
    expect(byId["WC-DEAD"].liveness).toBe("lease-expired");
    expect(byId["WC-MERGED"].disposition).toBe("delivered");
    expect(byId["WC-MERGED"].liveness).toBe("delivered");
  });

  it("does NOT select a token-PAUSED room (lease expired within the resume grace)", () => {
    const rows = [
      // Lease expired 1h ago — inside the 24h grace ⇒ paused, must be left alone.
      capsule({ capsuleId: "WC-PAUSED", executorKind: "grok-cli", leaseExpiresAt: new Date("2026-08-05T14:00:00.000Z") }),
    ];
    expect(selectReapCandidates(rows, new Map(), NOW)).toHaveLength(0);
  });
});

describe("annotateDeliveredSignals (procedural, local git — no LLM, no GitHub API)", () => {
  it("sets deliveredSignal from injected reachability for rows with a headSha", async () => {
    const rows = [
      capsule({ capsuleId: "WC-MERGED", headSha: "aaa", headBranch: "feat/x" }),
      capsule({ capsuleId: "WC-OPEN", headSha: "bbb", headBranch: "feat/y" }),
      capsule({ capsuleId: "WC-NOSHA", headSha: null }),
    ] as any[];
    await annotateDeliveredSignals(rows, {
      repoRoot: "/repo",
      hasTrunk: async () => true,
      reachable: async (_root, sha) => (sha === "aaa" ? true : false),
    });
    expect(rows[0].deliveredSignal).toEqual({ merged: true });
    expect(rows[1].deliveredSignal).toEqual({ merged: false });
    expect(rows[2].deliveredSignal).toBeUndefined(); // no sha → never probed
  });

  it("SHORT-CIRCUITS on a repo-less runtime (no local trunk) — leaves every signal null", async () => {
    const rows = [capsule({ capsuleId: "WC-MERGED", headSha: "aaa" })] as any[];
    const reachable = vi.fn();
    await annotateDeliveredSignals(rows, { repoRoot: "/repo", hasTrunk: async () => false, reachable });
    expect(reachable).not.toHaveBeenCalled();
    expect(rows[0].deliveredSignal).toBeUndefined();
  });

  it("leaves a row null when reachability is indeterminate (sha not fetched locally)", async () => {
    const rows = [capsule({ capsuleId: "WC-UNKNOWN", headSha: "ccc" })] as any[];
    await annotateDeliveredSignals(rows, {
      repoRoot: "/repo",
      hasTrunk: async () => true,
      reachable: async () => null, // git can't decide
    });
    expect(rows[0].deliveredSignal).toBeUndefined();
  });
});

function makeDb() {
  const db = {
    workroom: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    workroomActivity: { create: vi.fn() },
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
    db.workroom.findMany.mockResolvedValueOnce(deadRows());
    db.featureBuild.findMany.mockResolvedValueOnce([]);

    const result = await reapStaleWorkCapsules({ db: db as unknown as CapsuleDb, now: NOW });

    expect(result.dryRun).toBe(true);
    expect(result.reaped).toBe(0);
    expect(result.candidates.map((c) => c.capsuleId)).toEqual(["WC-LEASE-DEAD"]);
    // No mutation on the default path.
    expect(db.workroom.update).not.toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("transitions dead capsules to abandoned only when dryRun=false", async () => {
    db.workroom.findMany.mockResolvedValueOnce(deadRows());
    db.featureBuild.findMany.mockResolvedValueOnce([]);
    db.workroom.findUnique.mockResolvedValue({ id: "row-lease-dead", capsuleId: "WC-LEASE-DEAD", workspaceState: {} });
    db.workroom.update.mockResolvedValue({ id: "row-lease-dead", capsuleId: "WC-LEASE-DEAD" });

    const result = await reapStaleWorkCapsules({ db: db as unknown as CapsuleDb, now: NOW, dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.reaped).toBe(1);
    expect(db.workroom.update).toHaveBeenCalledTimes(1);
    expect(db.workroom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capsuleId: "WC-LEASE-DEAD" },
        data: expect.objectContaining({ status: "abandoned" }),
      }),
    );
    // The live capsule is never touched.
    expect(db.workroom.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { capsuleId: "WC-LIVE" } }),
    );
  });

  it("ARCHIVES a delivered (merged) room instead of abandoning it", async () => {
    // Pre-set deliveredSignal with NO headSha so annotateDeliveredSignals leaves
    // it intact (nothing to probe) — isolates the disposition→status branch.
    db.workroom.findMany.mockResolvedValueOnce([
      capsule({
        capsuleId: "WC-MERGED",
        executorKind: "grok-cli",
        leaseExpiresAt: new Date("2026-08-01T00:00:00.000Z"), // dead lease, but merged wins
        deliveredSignal: { merged: true },
      }),
    ]);
    db.featureBuild.findMany.mockResolvedValueOnce([]);
    db.workroom.findUnique.mockResolvedValue({ id: "row-merged", capsuleId: "WC-MERGED", workspaceState: {} });
    db.workroom.update.mockResolvedValue({ id: "row-merged", capsuleId: "WC-MERGED" });

    const result = await reapStaleWorkCapsules({ db: db as unknown as CapsuleDb, now: NOW, dryRun: false });

    expect(result.reaped).toBe(1);
    expect(result.candidates[0]!.disposition).toBe("delivered");
    expect(db.workroom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capsuleId: "WC-MERGED" },
        data: expect.objectContaining({ status: "archived" }), // NOT abandoned
      }),
    );
  });

  it("classifies zombie build-studio capsules via the linked build snapshot", async () => {
    db.workroom.findMany.mockResolvedValueOnce([
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
    prismaMock.workroom.findFirst.mockReset();
    prismaMock.workroom.findUnique.mockReset();
    prismaMock.workroom.update.mockReset();
    prismaMock.workroomActivity.create.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
  });

  it("abandons the non-terminal capsule attached to a reaped build", async () => {
    prismaMock.workroom.findFirst.mockResolvedValueOnce({ capsuleId: "WC-ZOMBIE" });
    prismaMock.workroom.findUnique.mockResolvedValueOnce({ id: "row-z", capsuleId: "WC-ZOMBIE", workspaceState: {} });
    prismaMock.workroom.update.mockResolvedValueOnce({ id: "row-z", capsuleId: "WC-ZOMBIE" });

    const did = await transitionCapsuleForTerminalBuild("FB-123", "inert — no activity in ideate.");

    expect(did).toBe(true);
    // Looks up by the build-studio idempotency key and only when non-terminal.
    expect(prismaMock.workroom.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ idempotencyKey: "build-studio:FB-123" }),
      }),
    );
    expect(prismaMock.workroom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "abandoned" }) }),
    );
  });

  it("is a no-op when no attached non-terminal capsule exists", async () => {
    prismaMock.workroom.findFirst.mockResolvedValueOnce(null);

    const did = await transitionCapsuleForTerminalBuild("FB-404", "stalled.");

    expect(did).toBe(false);
    expect(prismaMock.workroom.update).not.toHaveBeenCalled();
  });
});
