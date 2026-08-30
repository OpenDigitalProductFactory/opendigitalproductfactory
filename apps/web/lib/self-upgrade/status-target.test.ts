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

const version = vi.hoisted(() => ({ resolveTargetSha: vi.fn() }));

vi.mock("./release-target", () => releaseTarget);
vi.mock("@/lib/release-health/state", () => releaseHealth);
vi.mock("./version", () => version);

import {
  resolveSelfUpgradeStatusTarget,
  resolveVerifiedReleaseUpgradeCandidate,
} from "./status-target";

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

function call(log: (message: string) => void) {
  return resolveSelfUpgradeStatusTarget({ support, config, currentConfigDigest, log });
}

describe("resolveSelfUpgradeStatusTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releaseTarget.loadReleaseInstallContext.mockResolvedValue(context);
    releaseTarget.resolveReleaseTarget.mockReturnValue(target);
    releaseHealth.loadVerifiedReleaseTargetEvidence.mockResolvedValue(null);
    releaseHealth.recordVerifiedReleaseTargetEvidence.mockResolvedValue(true);
  });

  it("exposes the same verified fallback to non-presentation consumers", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate.mockResolvedValue({
      kind: "no-published-target",
      reason: "registry-unavailable",
    });
    releaseHealth.loadVerifiedReleaseTargetEvidence.mockResolvedValue(candidate);

    await expect(
      resolveVerifiedReleaseUpgradeCandidate({ context, currentConfigDigest }),
    ).resolves.toEqual(target);
  });

  it("retains an exact verified release target when a later registry read fails transiently", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate
      .mockResolvedValueOnce(target)
      .mockRejectedValueOnce(new Error("UND_ERR_CONNECT_TIMEOUT"));
    releaseHealth.loadVerifiedReleaseTargetEvidence.mockResolvedValue(candidate);
    const log = vi.fn();

    const first = await call(log);
    const second = await call(log);

    expect(first).toEqual({
      targetSha: candidate.sourceSha,
      targetTag: candidate.tag,
      availability: "resolved",
      unavailableReason: null,
      releaseFreshness: false,
    });
    expect(second).toEqual(first);
    expect(log).toHaveBeenCalledWith(
      "release-target-resolution-threw: UND_ERR_CONNECT_TIMEOUT",
    );
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
    const log = vi.fn();

    await expect(call(log)).resolves.toEqual({
      targetSha: null,
      targetTag: null,
      availability: "unavailable",
      unavailableReason: "registry-unavailable",
      releaseFreshness: null,
    });
    expect(log).toHaveBeenCalledWith(
      "release-target-resolution-threw: UND_ERR_CONNECT_TIMEOUT",
    );
    expect(log).toHaveBeenCalledWith("release-target-unavailable: registry-unavailable");
    expect(releaseTarget.resolveReleaseTarget).not.toHaveBeenCalled();
  });

  it("reports the typed reason when the registry read fails", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate.mockResolvedValue({
      kind: "no-published-target",
      reason: "registry-auth-invalid",
    });
    const log = vi.fn();

    const result = await call(log);

    expect(result.availability).toBe("unavailable");
    expect(result.unavailableReason).toBe("registry-auth-invalid");
    expect(log).toHaveBeenCalledWith("release-target-unavailable: registry-auth-invalid");
  });

  it("reports a thrown fault instead of silently collapsing it", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate.mockRejectedValue(new Error("socket hang up"));
    const log = vi.fn();

    const result = await call(log);

    expect(result.availability).toBe("unavailable");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("release-target-resolution-threw: socket hang up"),
    );
  });

  it("reports an unresolved install context rather than returning a bare unavailable", async () => {
    releaseTarget.loadReleaseInstallContext.mockResolvedValue(null);
    const log = vi.fn();

    const result = await call(log);

    expect(result.availability).toBe("unavailable");
    expect(log).toHaveBeenCalledWith("release-install-context-unresolved");
  });

  it("stays silent and resolves when a live target is available", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate.mockResolvedValue(target);
    const log = vi.fn();

    const result = await call(log);

    expect(result).toMatchObject({
      availability: "resolved",
      targetSha: candidate.sourceSha,
      targetTag: candidate.tag,
      unavailableReason: null,
      releaseFreshness: false,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("marks an up-to-date install as fresh, still without logging", async () => {
    releaseTarget.resolveReleaseUpgradeCandidate.mockResolvedValue({
      kind: "up-to-date",
      ...candidate,
      tag: context.imageTag,
    });
    const log = vi.fn();

    const result = await call(log);

    expect(result.availability).toBe("resolved");
    expect(result.releaseFreshness).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});
