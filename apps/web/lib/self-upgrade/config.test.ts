import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      findUnique: mockFindUnique,
    },
  },
}));

import {
  SELF_UPGRADE_CONFIG_KEY,
  SelfUpgradeConfigSchema,
  loadSelfUpgradeConfig,
} from "./config";

describe("SelfUpgradeConfigSchema", () => {
  it("accepts the installed Windows host path and normal dpf compose names", () => {
    const parsed = SelfUpgradeConfigSchema.parse({
      enabled: true,
      hostInstallPath: "D:/DPF",
      hostSourceMountPath: "/host-source",
      composeProject: "dpf",
      portalContainerName: "dpf-portal-1",
      dbContainerName: "dpf-postgres-1",
      repositoryRemote: "origin",
      repositoryBranch: "main",
      healthUrl: "http://localhost:3000/api/health",
    });

    expect(parsed.hostInstallPath).toBe("D:/DPF");
  });

  it("rejects shell metacharacters in host paths and container names", () => {
    expect(() =>
      SelfUpgradeConfigSchema.parse({
        enabled: true,
        hostInstallPath: "D:/DPF; rm -rf /",
        hostSourceMountPath: "/host-source",
        composeProject: "dpf",
        portalContainerName: "dpf-portal-1",
        dbContainerName: "dpf-postgres-1",
        repositoryRemote: "origin",
        repositoryBranch: "main",
        healthUrl: "http://localhost:3000/api/health",
      }),
    ).toThrow();
  });
});

describe("loadSelfUpgradeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DPF_HOST_INSTALL_PATH", "D:/DPF");
    vi.stubEnv("COMPOSE_PROJECT_NAME", "dpf");
    vi.stubEnv("DPF_PRODUCTION_DB_CONTAINER", "dpf-postgres-1");
  });

  it("loads operator PlatformConfig over environment defaults", async () => {
    mockFindUnique.mockResolvedValue({
      value: {
        enabled: false,
        hostInstallPath: "E:/DPF",
        composeProject: "dpf-prod",
        portalContainerName: "dpf-prod-portal-1",
      },
    });

    const config = await loadSelfUpgradeConfig();

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { key: SELF_UPGRADE_CONFIG_KEY },
      select: { value: true },
    });
    expect(config.enabled).toBe(false);
    expect(config.hostInstallPath).toBe("E:/DPF");
    expect(config.composeProject).toBe("dpf-prod");
    expect(config.portalContainerName).toBe("dpf-prod-portal-1");
    expect(config.repositoryBranch).toBe("main");
  });

  it("falls back to install environment when PlatformConfig is absent", async () => {
    mockFindUnique.mockResolvedValue(null);

    const config = await loadSelfUpgradeConfig();

    expect(config.enabled).toBe(true);
    expect(config.hostInstallPath).toBe("D:/DPF");
    expect(config.composeProject).toBe("dpf");
    expect(config.portalContainerName).toBe("dpf-portal-1");
  });
});
