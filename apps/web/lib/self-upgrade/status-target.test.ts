import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadReleaseInstallContext: vi.fn(),
  resolveReleaseUpgradeCandidate: vi.fn(),
  resolveTargetSha: vi.fn(),
}));

vi.mock("./release-target", () => ({
  loadReleaseInstallContext: mocks.loadReleaseInstallContext,
  resolveReleaseUpgradeCandidate: mocks.resolveReleaseUpgradeCandidate,
}));

vi.mock("./version", () => ({ resolveTargetSha: mocks.resolveTargetSha }));

import { resolveSelfUpgradeStatusTarget } from "./status-target";

const SUPPORT = {
  configuredEnabled: true,
  supported: true,
  enabled: true,
  targetKind: "release-artifact",
  reason: "enabled",
  message: null,
} as const;

const CONFIG = { channel: "stable", hostSourceMountPath: "/host-dpf" } as never;

const CONTEXT = {
  installMode: "consumer",
  imageTag: "v2026.08.29-x.1",
  channelTag: "latest",
  installPath: "D:\\DPF",
  composeFiles: ["docker-compose.yml"],
  ghcrOwner: "opendigitalproductfactory",
};

function call(log: (m: string) => void) {
  return resolveSelfUpgradeStatusTarget({
    support: SUPPORT,
    config: CONFIG,
    currentConfigDigest: `sha256:${"a".repeat(64)}`,
    log,
  });
}

describe("resolveSelfUpgradeStatusTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadReleaseInstallContext.mockResolvedValue(CONTEXT);
  });

  it("reports the typed reason when the registry read fails", async () => {
    mocks.resolveReleaseUpgradeCandidate.mockResolvedValue({
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
    // The regression: a throw became a bare null, every distinct cause turned
    // into "registry-unavailable", and nothing was logged — so a live
    // intermittent failure was undiagnosable from outside the process.
    mocks.resolveReleaseUpgradeCandidate.mockRejectedValue(new Error("socket hang up"));
    const log = vi.fn();

    const result = await call(log);

    expect(result.availability).toBe("unavailable");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("release-target-resolution-threw: socket hang up"),
    );
  });

  it("reports an unresolved install context rather than returning a bare unavailable", async () => {
    mocks.loadReleaseInstallContext.mockResolvedValue(null);
    const log = vi.fn();

    const result = await call(log);

    expect(result.availability).toBe("unavailable");
    expect(log).toHaveBeenCalledWith("release-install-context-unresolved");
  });

  it("stays silent and resolves when a target is available", async () => {
    mocks.resolveReleaseUpgradeCandidate.mockResolvedValue({
      kind: "target",
      tag: "v2026.08.30-owner-release-projection.1",
      sourceSha: "f13fcf1c568425d24e9b6dcbf44e65668a39b420",
    });
    const log = vi.fn();

    const result = await call(log);

    expect(result).toMatchObject({
      availability: "resolved",
      targetSha: "f13fcf1c568425d24e9b6dcbf44e65668a39b420",
      targetTag: "v2026.08.30-owner-release-projection.1",
      unavailableReason: null,
      releaseFreshness: false,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("marks an up-to-date install as fresh, still without logging", async () => {
    mocks.resolveReleaseUpgradeCandidate.mockResolvedValue({
      kind: "up-to-date",
      tag: "v2026.08.29-x.1",
      sourceSha: "b".repeat(40),
    });
    const log = vi.fn();

    const result = await call(log);

    expect(result.availability).toBe("resolved");
    expect(result.releaseFreshness).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});
