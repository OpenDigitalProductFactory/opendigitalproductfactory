import { describe, expect, it } from "vitest";
import {
  parseReleaseInstallContext,
  resolveReleaseTarget,
  resolveUpgradeStrategy,
} from "./release-target";

describe("consumer release target", () => {
  it("derives release strategy from consumer install state without consulting Git", () => {
    const context = parseReleaseInstallContext({
      state: {
        installMode: "consumer",
        imageTag: "v2026.08.22",
        installPath: "D:\\DPF",
        composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
      },
      markerMode: null,
      env: { GHCR_OWNER: "opendigitalproductfactory" },
    });

    expect(context).toEqual({
      installMode: "consumer",
      imageTag: "v2026.08.22",
      channelTag: "latest",
      installPath: "D:\\DPF",
      composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
      ghcrOwner: "opendigitalproductfactory",
    });
    expect(resolveUpgradeStrategy("upstream", context)).toBe("release");
  });

  it("keeps the update channel stable after an immutable image tag is installed", () => {
    const context = parseReleaseInstallContext({
      state: {
        installMode: "consumer",
        imageTag: "v2026.08.24",
        installPath: "/opt/dpf",
        composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
      },
      markerMode: null,
      env: {
        GHCR_OWNER: "opendigitalproductfactory",
        DPF_IMAGE_CHANNEL_TAG: "stable",
      },
    });

    expect(context?.imageTag).toBe("v2026.08.24");
    expect(context?.channelTag).toBe("stable");
  });

  it("uses the compatibility marker and release env while stale installer state converges", () => {
    const context = parseReleaseInstallContext({
      state: { installMode: null, imageTag: null, composeFiles: [] },
      markerMode: "consumer",
      env: {
        DPF_IMAGE_TAG: "v2026.08.22",
        GHCR_OWNER: "opendigitalproductfactory",
        DPF_HOST_INSTALL_PATH: "D:\\DPF",
        DPF_SELF_UPGRADE_COMPOSE_FILES: "docker-compose.yml docker-compose.release.yml",
      },
    });

    expect(context?.imageTag).toBe("v2026.08.22");
    expect(context?.composeFiles).toEqual(["docker-compose.yml", "docker-compose.release.yml"]);
    expect(resolveUpgradeStrategy("upstream", context)).toBe("release");
  });

  it("uses the base plus release topology for a legacy consumer with no recorded compose chain", () => {
    const context = parseReleaseInstallContext({
      state: { installMode: null, imageTag: null, composeFiles: [] },
      markerMode: "consumer",
      env: {
        DPF_IMAGE_TAG: "v2026.08.22",
        GHCR_OWNER: "opendigitalproductfactory",
        DPF_HOST_INSTALL_PATH: "D:\\DPF",
      },
    });
    expect(context?.composeFiles).toEqual(["docker-compose.yml", "docker-compose.release.yml"]);
  });

  it("projects host-absolute compose paths onto the candidate release asset root", () => {
    const context = parseReleaseInstallContext({
      state: {
        installMode: "consumer",
        imageTag: "v2026.08.22",
        installPath: "D:\\DPF",
        composeFiles: [
          "D:\\DPF\\docker-compose.yml",
          "D:\\DPF\\docker-compose.release.yml",
        ],
      },
      markerMode: null,
      env: { GHCR_OWNER: "opendigitalproductfactory" },
    });

    expect(context?.composeFiles).toEqual([
      "docker-compose.yml",
      "docker-compose.release.yml",
    ]);
  });

  it("keeps contributor and explicit local installs on the source strategy", () => {
    expect(resolveUpgradeStrategy("upstream", null)).toBe("source");
    expect(resolveUpgradeStrategy("local", {
      installMode: "consumer",
      imageTag: "v1.0.0",
      channelTag: "latest",
      installPath: "/opt/dpf",
      composeFiles: ["docker-compose.yml"],
      ghcrOwner: "owner",
    })).toBe("source");
  });

  it("returns an explicit up-to-date outcome when the running config bytes equal the channel candidate", () => {
    expect(resolveReleaseTarget({
      currentConfigDigest: `sha256:${"c".repeat(64)}`,
      candidate: {
        tag: "v2026.08.22",
        sourceSha: "a".repeat(40),
        channelDigest: `sha256:${"d".repeat(64)}`,
        platformManifestDigest: `sha256:${"e".repeat(64)}`,
        configDigest: `sha256:${"c".repeat(64)}`,
        platformOs: "linux",
        platformArchitecture: "amd64",
      },
    })).toEqual({
      kind: "up-to-date",
      tag: "v2026.08.22",
      sourceSha: "a".repeat(40),
      channelDigest: `sha256:${"d".repeat(64)}`,
      platformManifestDigest: `sha256:${"e".repeat(64)}`,
      configDigest: `sha256:${"c".repeat(64)}`,
      platformOs: "linux",
      platformArchitecture: "amd64",
    });
  });

  it("returns up to date when Docker exposes the running multi-arch channel digest", () => {
    const channelDigest = `sha256:${"d".repeat(64)}`;
    expect(resolveReleaseTarget({
      currentConfigDigest: channelDigest,
      candidate: {
        tag: "v2026.08.24-consumer-self-upgrade.6",
        sourceSha: "a".repeat(40),
        channelDigest,
        platformManifestDigest: `sha256:${"e".repeat(64)}`,
        configDigest: `sha256:${"c".repeat(64)}`,
        platformOs: "linux",
        platformArchitecture: "amd64",
      },
    })).toEqual({
      kind: "up-to-date",
      tag: "v2026.08.24-consumer-self-upgrade.6",
      sourceSha: "a".repeat(40),
      channelDigest,
      platformManifestDigest: `sha256:${"e".repeat(64)}`,
      configDigest: `sha256:${"c".repeat(64)}`,
      platformOs: "linux",
      platformArchitecture: "amd64",
    });
  });

  it("returns up to date when Docker exposes the running platform manifest digest", () => {
    const platformManifestDigest = `sha256:${"e".repeat(64)}`;
    expect(resolveReleaseTarget({
      currentConfigDigest: platformManifestDigest,
      candidate: {
        tag: "v2026.08.24-consumer-self-upgrade.6",
        sourceSha: "a".repeat(40),
        channelDigest: `sha256:${"d".repeat(64)}`,
        platformManifestDigest,
        configDigest: `sha256:${"c".repeat(64)}`,
        platformOs: "linux",
        platformArchitecture: "amd64",
      },
    }).kind).toBe("up-to-date");
  });

  it("returns a frozen immutable target when the channel bytes differ", () => {
    expect(resolveReleaseTarget({
      currentConfigDigest: `sha256:${"c".repeat(64)}`,
      candidate: {
        tag: "v2026.08.22",
        sourceSha: "b".repeat(40),
        channelDigest: `sha256:${"d".repeat(64)}`,
        platformManifestDigest: `sha256:${"e".repeat(64)}`,
        configDigest: `sha256:${"f".repeat(64)}`,
        platformOs: "linux",
        platformArchitecture: "amd64",
      },
    })).toEqual({
      kind: "target",
      tag: "v2026.08.22",
      sourceSha: "b".repeat(40),
      channelDigest: `sha256:${"d".repeat(64)}`,
      platformManifestDigest: `sha256:${"e".repeat(64)}`,
      configDigest: `sha256:${"f".repeat(64)}`,
      platformOs: "linux",
      platformArchitecture: "amd64",
    });
  });

  it("fails closed when release identity is incomplete", () => {
    expect(parseReleaseInstallContext({
      state: { installMode: "consumer", imageTag: null },
      markerMode: null,
      env: {},
    })).toBeNull();
    expect(resolveReleaseTarget({
      currentConfigDigest: null,
      candidate: null,
      unavailableReason: "registry-unavailable",
    })).toEqual({ kind: "no-published-target", reason: "registry-unavailable" });
  });
});
