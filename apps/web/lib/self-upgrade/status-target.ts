import type { SelfUpgradeConfig } from "./config";
import { getErrorMessage } from "@/lib/shared/get-error-message";
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
  /**
   * Sink for the reason a target could not be resolved. Injected rather than
   * calling `console` directly so a test can assert the reason is reported at
   * all — the defect being fixed is silence, so silence has to be testable.
   */
  log?: (message: string) => void;
}): Promise<SelfUpgradeStatusTarget> {
  // Defaulted here, not at the call sites: the point is that every caller emits
  // the reason without having to remember to ask for it.
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
  // A resolution failure has to leave a trace. `readRegistryReleaseCandidate`
  // returns a typed {ok:false, reason}, but anything that THREW became a bare
  // null here and every distinct cause collapsed into "registry-unavailable"
  // with nothing logged anywhere. An install then reports "no target" while a
  // newer release is published, and the reason is unrecoverable from outside
  // the process — a live intermittent fault (SUR-6B312E24) could not be
  // diagnosed at all, and the absence of any signal led to a confidently wrong
  // root cause being recorded against working code. BI-52C6FE5A.
  const target = await resolveReleaseUpgradeCandidate({
    context,
    currentConfigDigest: input.currentConfigDigest,
  }).catch((error: unknown) => {
    log(
      `release-target-resolution-threw: ${getErrorMessage(error)}`,
    );
    return null;
  });
  if (!target || target.kind === "no-published-target") {
    const unavailableReason = target?.reason ?? "registry-unavailable";
    log(`release-target-unavailable: ${unavailableReason}`);
    return { ...UNAVAILABLE, unavailableReason };
  }
  return {
    targetSha: target.sourceSha,
    targetTag: target.tag,
    availability: "resolved",
    unavailableReason: null,
    releaseFreshness: target.kind === "up-to-date",
  };
}
