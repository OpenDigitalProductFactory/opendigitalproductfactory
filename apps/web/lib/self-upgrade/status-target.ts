import type { SelfUpgradeConfig } from "./config";
import { loadReleaseInstallContext, resolveReleaseUpgradeCandidate } from "./release-target";
import type { SelfUpgradeSupport } from "./support";
import { resolveTargetSha } from "./version";

export type SelfUpgradeStatusTarget = Readonly<{
  targetSha: string | null;
  targetTag: string | null;
  availability: "resolved" | "unavailable";
  unavailableReason: string | null;
  releaseFreshness: boolean | null;
}>;

const UNAVAILABLE: SelfUpgradeStatusTarget = Object.freeze({
  targetSha: null,
  targetTag: null,
  availability: "unavailable",
  unavailableReason: "no-target",
  releaseFreshness: null,
});

export async function resolveSelfUpgradeStatusTarget(input: {
  support: SelfUpgradeSupport;
  config: SelfUpgradeConfig;
  currentConfigDigest: string | null;
}): Promise<SelfUpgradeStatusTarget> {
  if (!input.support.supported) return UNAVAILABLE;
  if (input.support.targetKind === "git-source") {
    const targetSha = await resolveTargetSha(input.config.channel, input.config);
    return {
      ...UNAVAILABLE,
      targetSha,
      availability: targetSha ? "resolved" : "unavailable",
      unavailableReason: targetSha ? null : "no-target",
    };
  }

  const context = await loadReleaseInstallContext({
    hostSourcePath:
      input.config.hostSourceMountPath ??
      process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT ??
      "/host-dpf",
  });
  if (!context) return UNAVAILABLE;
  const target = await resolveReleaseUpgradeCandidate({
    context,
    currentConfigDigest: input.currentConfigDigest,
  }).catch(() => null);
  if (!target || target.kind === "no-published-target") {
    return {
      ...UNAVAILABLE,
      unavailableReason: target?.reason ?? "registry-unavailable",
    };
  }
  return {
    targetSha: target.sourceSha,
    targetTag: target.tag,
    availability: "resolved",
    unavailableReason: null,
    releaseFreshness: target.kind === "up-to-date",
  };
}
