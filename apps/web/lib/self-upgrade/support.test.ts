import { describe, expect, it } from "vitest";
import type { InstallHostProfile } from "@/lib/install/host-profile";
import { resolveSelfUpgradeSupport } from "./support";

function profile(
  kind: InstallHostProfile["kind"],
  sourceCapable = kind === "source",
): InstallHostProfile {
  return {
    kind,
    installMode: kind === "consumer" ? "consumer" : kind === "source" ? "customizer" : null,
    sourceCapable,
    releaseImage: kind === "consumer",
    reason:
      kind === "consumer"
        ? "consumer-release-install"
        : kind === "source"
          ? "git-source-present"
          : "insufficient-install-evidence",
  };
}

describe("resolveSelfUpgradeSupport", () => {
  it("does not expose source self-upgrade as enabled on a consumer release", () => {
    expect(resolveSelfUpgradeSupport(profile("consumer"), true)).toEqual({
      configuredEnabled: true,
      supported: false,
      enabled: false,
      targetKind: "release-artifact",
      reason: "consumer-release-upgrade-unsupported",
      message: "Automatic updates aren’t available for this install yet.",
    });
  });

  it("keeps the source pipeline available when the host has a Git checkout", () => {
    expect(resolveSelfUpgradeSupport(profile("source"), true)).toEqual({
      configuredEnabled: true,
      supported: true,
      enabled: true,
      targetKind: "git-source",
      reason: "enabled",
      message: null,
    });
  });

  it("distinguishes an operator-disabled source pipeline from unsupported installs", () => {
    expect(resolveSelfUpgradeSupport(profile("source"), false)).toEqual({
      configuredEnabled: false,
      supported: true,
      enabled: false,
      targetKind: "git-source",
      reason: "disabled-by-config",
      message: "Automatic updates are turned off for this source-backed install.",
    });
  });

  it("fails closed when install identity is unverified", () => {
    expect(resolveSelfUpgradeSupport(profile("unknown"), true)).toEqual({
      configuredEnabled: true,
      supported: false,
      enabled: false,
      targetKind: "unknown",
      reason: "install-identity-unverified",
      message: "Automatic updates are unavailable until this install’s identity is verified.",
    });
  });
});
