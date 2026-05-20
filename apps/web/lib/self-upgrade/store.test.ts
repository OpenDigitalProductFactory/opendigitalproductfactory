import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  Prisma: {},
  prisma: {
    selfUpgradeRun: {
      create: db.create,
      update: db.update,
    },
  },
}));

import {
  createSelfUpgradeRun,
  generateSelfUpgradeRunId,
  markSelfUpgradeRunSkipped,
  markSelfUpgradeRunStarted,
} from "./store";

const versionState = {
  currentSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  targetSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  upToDate: false,
  comparable: true,
  reason: "behind-target" as const,
};

describe("generateSelfUpgradeRunId", () => {
  it("uses the SUR prefix and a short stable token shape", () => {
    expect(generateSelfUpgradeRunId()).toMatch(/^SUR-[A-F0-9]{8}$/);
  });
});

describe("createSelfUpgradeRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists queued runs with version and config evidence", async () => {
    db.create.mockResolvedValue({});

    const result = await createSelfUpgradeRun({
      trigger: "manual",
      config: {
        composeProject: "dpf",
        repositoryRemote: "origin",
        repositoryBranch: "main",
      },
      versionState,
    });

    expect(result.runId).toMatch(/^SUR-[A-F0-9]{8}$/);
    expect(db.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: result.runId,
        status: "queued",
        trigger: "manual",
        currentSha: versionState.currentSha,
        targetSha: versionState.targetSha,
        completionEvidence: expect.objectContaining({
          reason: "behind-target",
          comparable: true,
          composeProject: "dpf",
          repositoryRemote: "origin",
          repositoryBranch: "main",
        }),
      }),
    });
  });
});

describe("markSelfUpgradeRunSkipped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records skipped runs with optional version evidence", async () => {
    db.create.mockResolvedValue({});

    await markSelfUpgradeRunSkipped({
      trigger: "scheduled",
      reason: "up-to-date",
      versionState,
    });

    expect(db.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "skipped",
        trigger: "scheduled",
        reason: "up-to-date",
        currentSha: versionState.currentSha,
        targetSha: versionState.targetSha,
        completedAt: expect.any(Date),
        completionEvidence: expect.objectContaining({
          reason: "behind-target",
          comparable: true,
        }),
      }),
    });
  });
});

describe("markSelfUpgradeRunStarted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves a queued run to running and stores the promoter container", async () => {
    db.update.mockResolvedValue({});

    await markSelfUpgradeRunStarted({
      runId: "SUR-12345678",
      promoter: { containerName: "dpf-promoter-self-upgrade-SUR-12345678" },
    });

    expect(db.update).toHaveBeenCalledWith({
      where: { runId: "SUR-12345678" },
      data: {
        status: "running",
        startedAt: expect.any(Date),
        promoterContainerName: "dpf-promoter-self-upgrade-SUR-12345678",
      },
    });
  });
});
