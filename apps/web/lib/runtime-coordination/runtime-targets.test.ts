import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canSatisfyFinalAcceptance,
  deriveAcceptanceRole,
  isRuntimeTargetKind,
  isRuntimeTargetStatus,
  isRuntimeVerificationKind,
  isRuntimeVerificationStatus,
  getRuntimeCoordinationMap,
  heartbeatRuntimeTarget,
  releaseRuntimeTarget,
  recordRuntimeVerification,
  registerRuntimeTarget,
  resolveAcceptanceRole,
  resolveRuntimeTargetOwnership,
  type RuntimeCoordinationDb,
} from "./runtime-targets";

const db = {
  runtimeTarget: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  runtimeVerification: {
    create: vi.fn(),
  },
  buildActivity: {
    create: vi.fn(),
  },
  workroomActivity: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};

function resetDb() {
  db.runtimeTarget.create.mockReset();
  db.runtimeTarget.findMany.mockReset();
  db.runtimeTarget.findUnique.mockReset();
  db.runtimeTarget.update.mockReset();
  db.runtimeVerification.create.mockReset();
  db.buildActivity.create.mockReset();
  db.workroomActivity.create.mockReset();
  db.$transaction.mockReset();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
}

function runtimeDb(): RuntimeCoordinationDb {
  return db as unknown as RuntimeCoordinationDb;
}

describe("runtime target types", () => {
  it("derives acceptance role from runtime kind instead of storing a normal column", () => {
    expect(deriveAcceptanceRole("root-portal")).toBe("final-acceptance");
    expect(deriveAcceptanceRole("dev-portal")).toBe("non-prod-verification");
    expect(deriveAcceptanceRole("build-sandbox")).toBe("non-prod-verification");
    expect(deriveAcceptanceRole("git-promotion-sandbox")).toBe("non-prod-verification");
    expect(deriveAcceptanceRole("external-preview")).toBe("non-prod-verification");
    expect(deriveAcceptanceRole("ad-hoc-debug")).toBe("debug-only");

    expect(canSatisfyFinalAcceptance("root-portal")).toBe(true);
    expect(canSatisfyFinalAcceptance("build-sandbox")).toBe(false);
    expect(canSatisfyFinalAcceptance("ad-hoc-debug")).toBe(false);
    expect(resolveAcceptanceRole("root-portal", "debug-only")).toBe("debug-only");
    expect(canSatisfyFinalAcceptance("root-portal", "debug-only")).toBe(false);
  });

  it("exposes canonical enum guards for MCP schemas and runtime validation", () => {
    expect(isRuntimeTargetKind("root-portal")).toBe(true);
    expect(isRuntimeTargetKind("random-port")).toBe(false);
    expect(isRuntimeTargetStatus("misconfigured")).toBe(true);
    expect(isRuntimeTargetStatus("available")).toBe(false);
    expect(isRuntimeVerificationKind("final-acceptance")).toBe(true);
    expect(isRuntimeVerificationKind("preview")).toBe(false);
    expect(isRuntimeVerificationStatus("waived")).toBe(true);
    expect(isRuntimeVerificationStatus("complete")).toBe(false);
  });
});

describe("registerRuntimeTarget", () => {
  beforeEach(() => resetDb());

  it("creates a slim runtime target without duplicating source ownership fields", async () => {
    db.runtimeTarget.findUnique.mockResolvedValueOnce(null);
    db.runtimeTarget.create.mockResolvedValueOnce({
      id: "row-1",
      targetId: "RT-ROOT-PORTAL",
      kind: "root-portal",
      status: "running",
    });

    const result = await registerRuntimeTarget({
      db: runtimeDb(),
      input: {
        targetId: "RT-ROOT-PORTAL",
        kind: "root-portal",
        status: "running",
        serviceName: "portal",
        containerName: "dpf-portal-1",
        hostUrl: "http://localhost:3000",
        port: 3000,
        serviceVersion: "image:07133d5e git:07133d5e",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "PRN-1" },
      now: new Date("2026-05-18T01:00:00.000Z"),
    });

    expect(result.targetId).toBe("RT-ROOT-PORTAL");
    expect(db.runtimeTarget.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        repositoryFullName: expect.anything(),
        headBranch: expect.anything(),
        headSha: expect.anything(),
        pullRequestUrl: expect.anything(),
      }),
    }));
    expect(db.runtimeTarget.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "root-portal",
        status: "running",
        serviceVersion: "image:07133d5e git:07133d5e",
        lastHeartbeatAt: new Date("2026-05-18T01:00:00.000Z"),
      }),
    }));
  });

  it("updates an existing target idempotently and records capsule activity when linked", async () => {
    db.runtimeTarget.findUnique.mockResolvedValueOnce({
      id: "row-1",
      targetId: "RT-BUILD-FB-1",
      workCapsuleId: "capsule-row-1",
    });
    db.runtimeTarget.update.mockResolvedValueOnce({
      id: "row-1",
      targetId: "RT-BUILD-FB-1",
      status: "running",
    });
    db.workroomActivity.create.mockResolvedValueOnce({ id: "activity-1" });

    await registerRuntimeTarget({
      db: runtimeDb(),
      input: {
        targetId: "RT-BUILD-FB-1",
        kind: "build-sandbox",
        status: "running",
        workCapsuleId: "capsule-row-1",
        featureBuildId: "feature-build-row-1",
        sandboxId: "sandbox-row-1",
        hostUrl: "http://localhost:3035",
      },
      actor: { userId: "user-1", agentId: "codex", principalId: "PRN-1" },
    });

    expect(db.runtimeTarget.create).not.toHaveBeenCalled();
    expect(db.runtimeTarget.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { targetId: "RT-BUILD-FB-1" },
      data: expect.objectContaining({
        featureBuildId: "feature-build-row-1",
        sandboxId: "sandbox-row-1",
      }),
    }));
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workCapsuleId: "capsule-row-1",
        kind: "runtime-target-registered",
      }),
    }));
  });

  it("requires a debug reason for ad-hoc debug runtimes", async () => {
    await expect(registerRuntimeTarget({
      db: runtimeDb(),
      input: {
        targetId: "RT-DEBUG-4321",
        kind: "ad-hoc-debug",
        status: "running",
        port: 4321,
      },
      actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
    })).rejects.toThrow(/debugReason/i);
  });

  it("heartbeats and releases targets through service helpers", async () => {
    const now = new Date("2026-05-18T03:00:00.000Z");
    db.runtimeTarget.update
      .mockResolvedValueOnce({ id: "target-row-1", targetId: "RT-BUILD-FB-1" })
      .mockResolvedValueOnce({
        id: "target-row-1",
        targetId: "RT-BUILD-FB-1",
        workCapsuleId: "capsule-row-1",
      });
    db.workroomActivity.create.mockResolvedValueOnce({ id: "activity-1" });

    await heartbeatRuntimeTarget({
      db: runtimeDb(),
      targetId: "RT-BUILD-FB-1",
      now,
    });
    await releaseRuntimeTarget({
      db: runtimeDb(),
      targetId: "RT-BUILD-FB-1",
      actor: { userId: "user-1", agentId: "codex", principalId: "PRN-1" },
      now,
    });

    expect(db.runtimeTarget.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { targetId: "RT-BUILD-FB-1" },
      data: { lastHeartbeatAt: now },
    }));
    expect(db.runtimeTarget.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { targetId: "RT-BUILD-FB-1" },
      data: { status: "released", lastHeartbeatAt: now },
    }));
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workCapsuleId: "capsule-row-1",
        kind: "runtime-target-released",
      }),
    }));
  });

  it("returns a coordination map with derived acceptance metadata", async () => {
    db.runtimeTarget.findMany.mockResolvedValueOnce([
      {
        targetId: "RT-ROOT-PORTAL",
        kind: "root-portal",
        status: "running",
        acceptanceRoleOverride: "debug-only",
        verifications: [],
        workCapsule: {
          leaseHolderPrincipalId: "PRN-LEASE",
          createdByPrincipalId: "PRN-CREATOR",
          headBranch: "feat/runtime",
          headSha: "abc123",
          pullRequestUrl: "https://github.test/pr/781",
          pullRequestNumber: 781,
        },
        featureBuild: null,
      },
    ]);

    const result = await getRuntimeCoordinationMap({
      db: runtimeDb(),
      status: "running",
      limit: 5,
    });

    expect(db.runtimeTarget.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "running" },
      take: 5,
    }));
    expect(result.targets[0]).toMatchObject({
      targetId: "RT-ROOT-PORTAL",
      acceptanceRole: "debug-only",
      canSatisfyFinalAcceptance: false,
      ownership: {
        ownerPrincipalId: "PRN-LEASE",
        branch: "feat/runtime",
        sha: "abc123",
        pullRequestNumber: 781,
      },
    });
  });

  it("resolves ownership from linked capsule/build data without duplicating it on the target", () => {
    const ownership = resolveRuntimeTargetOwnership({
      workCapsule: {
        leaseHolderPrincipalId: "PRN-LEASE",
        createdByPrincipalId: "PRN-CREATOR",
        headBranch: "feat/runtime-coordination-targets",
        headSha: "cbbc9862",
        pullRequestUrl: "https://github.test/pr/1",
        pullRequestNumber: 1,
      },
      featureBuild: {
        buildId: "FB-1",
        buildBranch: "feat/build-branch",
        gitCommitHashes: ["build-sha"],
        createdById: "user-build",
        claimedByAgentId: "agent-build",
      },
    });

    expect(ownership).toEqual({
      ownerPrincipalId: "PRN-LEASE",
      branch: "feat/runtime-coordination-targets",
      sha: "cbbc9862",
      pullRequestUrl: "https://github.test/pr/1",
      pullRequestNumber: 1,
      buildId: "FB-1",
      ownerUserId: "user-build",
      ownerAgentId: "agent-build",
    });
  });
});

describe("recordRuntimeVerification", () => {
  beforeEach(() => resetDb());

  it("requires exactly one primary attach point", async () => {
    await expect(recordRuntimeVerification({
      db: runtimeDb(),
      input: {
        verificationId: "RV-BAD",
        kind: "ux",
        status: "passed",
        runtimeTargetId: "target-row-1",
        featureBuildId: "feature-build-row-1",
      },
    })).rejects.toThrow(/exactly one primary attach point/i);
  });

  it("records verification and mirrors to Work Capsule activity when linked", async () => {
    db.buildActivity.create.mockResolvedValueOnce({ id: "build-activity-1" });
    db.runtimeVerification.create.mockResolvedValueOnce({
      id: "verification-row-1",
      verificationId: "RV-UX-1",
      status: "passed",
    });
    db.workroomActivity.create.mockResolvedValueOnce({ id: "activity-1" });

    const result = await recordRuntimeVerification({
      db: runtimeDb(),
      input: {
        verificationId: "RV-UX-1",
        kind: "ux",
        status: "passed",
        runtimeTargetId: "target-row-1",
        workCapsuleId: "capsule-row-1",
        buildId: "FB-1",
        url: "http://localhost:3035/build",
        screenshotUrl: "/api/build/FB-1/evidence/screen.png",
        result: { checked: ["/build"] },
      },
    });

    expect(result.verificationId).toBe("RV-UX-1");
    expect(db.runtimeVerification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "ux",
        status: "passed",
        runtimeTargetId: "target-row-1",
        workCapsuleId: "capsule-row-1",
        buildActivityId: "build-activity-1",
      }),
    }));
    expect(db.buildActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        buildId: "FB-1",
        tool: "runtime_verification:ux",
        summary: "Runtime verification RV-UX-1 passed.",
      }),
    }));
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workCapsuleId: "capsule-row-1",
        kind: "runtime-verification-passed",
      }),
    }));
  });

  it("does not mirror non-terminal-success statuses as passed capsule activity", async () => {
    db.runtimeVerification.create.mockResolvedValueOnce({
      id: "verification-row-2",
      verificationId: "RV-WAIVED-1",
      status: "waived",
    });

    await recordRuntimeVerification({
      db: runtimeDb(),
      input: {
        verificationId: "RV-WAIVED-1",
        kind: "ux",
        status: "waived",
        runtimeTargetId: "target-row-1",
        workCapsuleId: "capsule-row-1",
      },
    });

    expect(db.runtimeVerification.create).toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });
});
