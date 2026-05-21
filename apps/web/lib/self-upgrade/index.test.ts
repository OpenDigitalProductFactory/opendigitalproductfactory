import { describe, it, expect, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: { findUnique: vi.fn() },
    selfUpgradeRun: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    featureBuild: { findUnique: vi.fn() },
  },
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}));

import * as SelfUpgrade from "./index";

describe("self-upgrade barrel export", () => {
  it("exports config APIs", () => {
    expect(SelfUpgrade).toHaveProperty("getSelfUpgradeConfig");
    expect(SelfUpgrade).toHaveProperty("parseSelfUpgradeConfig");
    expect(SelfUpgrade).toHaveProperty("isInMaintenanceWindow");
  });

  it("exports version APIs", () => {
    expect(SelfUpgrade).toHaveProperty("resolveTargetSha");
    expect(SelfUpgrade).toHaveProperty("isShaFresh");
  });

  it("exports run-store APIs", () => {
    expect(SelfUpgrade).toHaveProperty("createRun");
    expect(SelfUpgrade).toHaveProperty("startRun");
    expect(SelfUpgrade).toHaveProperty("completeRun");
    expect(SelfUpgrade).toHaveProperty("failRun");
    expect(SelfUpgrade).toHaveProperty("cancelRun");
    expect(SelfUpgrade).toHaveProperty("appendLog");
    expect(SelfUpgrade).toHaveProperty("getLatestRun");
    expect(SelfUpgrade).toHaveProperty("getRun");
  });

  it("exports promoter APIs", () => {
    expect(SelfUpgrade).toHaveProperty("runPromoter");
  });

  it("exports completion APIs", () => {
    expect(SelfUpgrade).toHaveProperty("isFeatureBuildDeployed");
    expect(SelfUpgrade).toHaveProperty("getDeployedSha");
    expect(SelfUpgrade).toHaveProperty("shaContains");
    expect(SelfUpgrade).toHaveProperty("getBuildMergeSha");
  });

  it("exports notification APIs", () => {
    expect(SelfUpgrade).toHaveProperty("emitUpgradeEvent");
  });
});
