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
      installPath: "D:\\DPF",
      composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
      ghcrOwner: "opendigitalproductfactory",
    });
    expect(resolveUpgradeStrategy("upstream", context)).toBe("release");
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
      installPath: "/opt/dpf",
      composeFiles: ["docker-compose.yml"],
      ghcrOwner: "owner",
    })).toBe("source");
  });

  it("returns an explicit up-to-date outcome for the installed verified tag", () => {
    expect(resolveReleaseTarget({
      currentImageTag: "v2026.08.22",
      currentSourceSha: "a".repeat(40),
      latest: {
        tag: "v2026.08.22",
        headSha: "a".repeat(40),
        status: "verified",
      },
    })).toEqual({ kind: "up-to-date", tag: "v2026.08.22", sourceSha: "a".repeat(40) });
  });

  it("returns only a verified immutable release target", () => {
    expect(resolveReleaseTarget({
      currentImageTag: "v2026.08.21",
      currentSourceSha: "a".repeat(40),
      latest: {
        tag: "v2026.08.22",
        headSha: "b".repeat(40),
        status: "verified",
      },
    })).toEqual({ kind: "target", tag: "v2026.08.22", sourceSha: "b".repeat(40) });

    expect(resolveReleaseTarget({
      currentImageTag: "v2026.08.21",
      currentSourceSha: "a".repeat(40),
      latest: {
        tag: "v2026.08.22",
        headSha: "b".repeat(40),
        status: "verify-failed",
      },
    })).toEqual({ kind: "no-published-target", reason: "verify-failed" });
  });

  it("fails closed when release identity is incomplete", () => {
    expect(parseReleaseInstallContext({
      state: { installMode: "consumer", imageTag: null },
      markerMode: null,
      env: {},
    })).toBeNull();
    expect(resolveReleaseTarget({
      currentImageTag: "v1.0.0",
      currentSourceSha: null,
      latest: { tag: "v1.1.0", headSha: null, status: "verified" },
    })).toEqual({ kind: "no-published-target", reason: "source-sha-missing" });
  });
});
