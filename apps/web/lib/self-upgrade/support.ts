import {
  readInstallHostProfile,
  type InstallHostProfile,
} from "../install/host-profile";

export type SelfUpgradeTargetKind = "git-source" | "release-artifact" | "unknown";
export type SelfUpgradeSupportReason =
  | "enabled"
  | "disabled-by-config"
  | "consumer-release-upgrade-unsupported"
  | "install-identity-unverified";

type SelfUpgradeSupportBase = {
  /** Stored operator preference, preserved separately from effective availability. */
  configuredEnabled: boolean;
};

export type SelfUpgradeSupport = SelfUpgradeSupportBase &
  (
    | {
        supported: true;
        enabled: boolean;
        targetKind: "git-source";
        reason: "enabled" | "disabled-by-config";
        message: string | null;
      }
    | {
        supported: false;
        enabled: false;
        targetKind: "release-artifact";
        reason: "consumer-release-upgrade-unsupported";
        message: string;
      }
    | {
        supported: false;
        enabled: false;
        targetKind: "unknown";
        reason: "install-identity-unverified";
        message: string;
      }
  );

export const UNKNOWN_SELF_UPGRADE_SUPPORT: SelfUpgradeSupport = {
  configuredEnabled: false,
  supported: false,
  enabled: false,
  targetKind: "unknown",
  reason: "install-identity-unverified",
  message: "Automatic updates are unavailable until this install’s identity is verified.",
};

export function resolveSelfUpgradeSupport(
  profile: InstallHostProfile,
  configuredEnabled: boolean,
): SelfUpgradeSupport {
  if (profile.kind === "consumer") {
    return {
      configuredEnabled,
      supported: false,
      enabled: false,
      targetKind: "release-artifact",
      reason: "consumer-release-upgrade-unsupported",
      message: "Automatic updates aren’t available for this install yet.",
    };
  }

  if (profile.kind !== "source" || !profile.sourceCapable) {
    return {
      ...UNKNOWN_SELF_UPGRADE_SUPPORT,
      configuredEnabled,
    };
  }

  return {
    configuredEnabled,
    supported: true,
    enabled: configuredEnabled,
    targetKind: "git-source",
    reason: configuredEnabled ? "enabled" : "disabled-by-config",
    message: configuredEnabled
      ? null
      : "Automatic updates are turned off for this source-backed install.",
  };
}

export async function readSelfUpgradeSupport(
  configuredEnabled: boolean,
): Promise<SelfUpgradeSupport> {
  return resolveSelfUpgradeSupport(await readInstallHostProfile(), configuredEnabled);
}
