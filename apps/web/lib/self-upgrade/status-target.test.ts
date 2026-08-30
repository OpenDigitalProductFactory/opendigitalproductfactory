import { beforeEach, describe, expect, it, vi } from "vitest";

const releaseTarget = vi.hoisted(() => ({
  loadReleaseInstallContext: vi.fn(),
  resolveReleaseTarget: vi.fn(),
  resolveReleaseUpgradeCandidate: vi.fn(),
}));

const releaseHealth = vi.hoisted(() => ({
  loadVerifiedReleaseTargetEvidence: vi.fn(),
  recordVerifiedReleaseTargetEvidence: vi.fn(),
}));

vi.mock("./release-target", () => releaseTarget);
vi.mock("@/lib/release-health/state", () => releaseHealth);

import { resolveSelfUpgradeStatusTarget } from "./status-target";

const config = {
  enabled: true,
  channel: "stable",
  checkIntervalHours: 24,
  cooldownMinutes: 60,
  batchMinPendingPrs: 1,
  batchMaxWaitHours: 24,
  healthTarget: 100,
  maintenanceWindows: [],
  sourceMode: "upstream" as const,
  installBranch: "dpf/install",
  useIsolatedWorkspace: true,
};

const support = {
  configuredEnabled: true,
  supported: true as const,
  enabled: true,
  targetKind: "release-artifact" as const,
  reason: "enabled" as const,
  message: null,
};

const context = {
  installMode: "consumer" as const,
  imageTag: "v2026.08.29-rendered-target-admission.1",
  channelTag: "latest",
  installPath: "D:/DPF",
  composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
  ghcrOwner: "opendigitalproductfactory",
};

const candidate = {
  tag: "v2026.08.30-owner-release-projection.1",
  sourceSha: "f13fcf1c568425d24e9b6dcbf44e65668a39b420",
  channelDigest: `sha256:${"a".repeat(64)}`,
  platformManifestDigest: `sha256:${"b".repeat(64)}`,
  configDigest: `sha256:${"c".repeat(64)}`,
  platformOs: "linux" as const,
  platformArchitecture: "amd64",
};

const target = { kind: "target" as const, ...candidate };
const currentConfigDigest = `sha256:${"d".repeat(64)}`;

describe("resolveSelfUpgradeStatusTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releaseTarget.loadReleaseInstallContext.mockResolvedValue(context);
    releaseTarget.resolveReleaseTarget.mockReturnValue(target);
    releaseHealth.loadVerifiedReleaseTargetEvidence.mockResolvedValue(null);
    releaseHealth.recordVerifiedReleaseTargetEvidence.mockResolvedValue(true);
  });

  it("retains an exact verified release target when a later registry read fails transiently", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate
      .mockResolvedValueOnce(target)
      .mockRejectedValueOnce(new Error("UND_ERR_CONNECT_TIMEOUT"));
    releaseHealth.loadVerifiedReleaseTargetEvidence.mockResolvedValue(candidate);

    const first = await resolveSelfUpgradeStatusTarget({ support, config, currentConfigDigest });
    const second = await resolveSelfUpgradeStatusTarget({ support, config, currentConfigDigest });

    expect(first).toEqual({
      targetSha: candidate.sourceSha,
      targetTag: candidate.tag,
      availability: "resolved",
      unavailableReason: null,
      releaseFreshness: false,
    });
    expect(second).toEqual(first);
    expect(releaseHealth.recordVerifiedReleaseTargetEvidence).toHaveBeenCalledWith({
      candidate,
      context,
      currentConfigDigest,
    });
    expect(releaseHealth.loadVerifiedReleaseTargetEvidence).toHaveBeenCalledWith({
      context,
      currentConfigDigest,
    });
  });

  it("remains unavailable when registry discovery fails without persisted verified evidence", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate.mockRejectedValue(
      new Error("UND_ERR_CONNECT_TIMEOUT"),
    );

    await expect(
      resolveSelfUpgradeStatusTarget({ support, config, currentConfigDigest }),
    ).resolves.toEqual({
      targetSha: null,
      targetTag: null,
      availability: "unavailable",
      unavailableReason: "registry-unavailable",
      releaseFreshness: null,
    });
    expect(releaseTarget.resolveReleaseTarget).not.toHaveBeenCalled();
  });
});
