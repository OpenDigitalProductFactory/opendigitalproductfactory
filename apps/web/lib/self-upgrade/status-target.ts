import type { SelfUpgradeConfig } from "./config";
import {
  loadReleaseInstallContext,
} from "./release-target";
import type { SelfUpgradeSupport } from "./support";
import { resolveVerifiedReleaseUpgradeCandidate } from "./verified-release-target";
import { resolveTargetSha } from "./version";

export { resolveVerifiedReleaseUpgradeCandidate } from "./verified-release-target";

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
  /**
   * Sink for the reason a target could not be resolved. Injected rather than
   * calling `console` directly so a test can assert the reason is reported at
   * all — the defect being fixed is silence, so silence has to be testable.
   */
  log?: (message: string) => void;
}): Promise<SelfUpgradeStatusTarget> {
  // Defaulted here, not at the call sites: every caller reports a resolution
  // failure without having to remember to opt in.
  const log = input.log ?? ((message: string) => console.warn(`[self-upgrade] ${message}`));
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
  if (!context) {
    log("release-install-context-unresolved");
    return UNAVAILABLE;
  }

  const target = await resolveVerifiedReleaseUpgradeCandidate({
    context,
    currentConfigDigest: input.currentConfigDigest,
    log,
  });
  if (target.kind === "no-published-target") {
    return { ...UNAVAILABLE, unavailableReason: target.reason };
  }
  return {
    targetSha: target.sourceSha,
    targetTag: target.tag,
    availability: "resolved",
    unavailableReason: null,
    releaseFreshness: target.kind === "up-to-date",
  };
}
