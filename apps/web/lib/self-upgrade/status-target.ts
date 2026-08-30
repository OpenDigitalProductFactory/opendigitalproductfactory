import type { SelfUpgradeConfig } from "./config";
import {
  loadVerifiedReleaseTargetEvidence,
  recordVerifiedReleaseTargetEvidence,
} from "@/lib/release-health/state";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  loadReleaseInstallContext,
  resolveReleaseTarget,
  resolveReleaseUpgradeCandidate,
} from "./release-target";
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

  // Registry discovery remains primary. A thrown fault is still reported even
  // when the independently verified persisted candidate recovers the page, so
  // intermittent process-level degradation remains observable.
  const liveTarget = await resolveReleaseUpgradeCandidate({
    context,
    currentConfigDigest: input.currentConfigDigest,
  }).catch((error: unknown) => {
    log(`release-target-resolution-threw: ${getErrorMessage(error)}`);
    return null;
  });
  if (liveTarget && liveTarget.kind !== "no-published-target") {
    const { kind: _kind, ...candidate } = liveTarget;
    await recordVerifiedReleaseTargetEvidence({
      candidate,
      context,
      currentConfigDigest: input.currentConfigDigest ?? "",
    }).catch(() => false);
    return {
      targetSha: liveTarget.sourceSha,
      targetTag: liveTarget.tag,
      availability: "resolved",
      unavailableReason: null,
      releaseFreshness: liveTarget.kind === "up-to-date",
    };
  }

  const persistedCandidate = input.currentConfigDigest
    ? await loadVerifiedReleaseTargetEvidence({
        context,
        currentConfigDigest: input.currentConfigDigest,
      }).catch(() => null)
    : null;
  const target = persistedCandidate
    ? resolveReleaseTarget({
        currentConfigDigest: input.currentConfigDigest,
        candidate: persistedCandidate,
      })
    : null;
  if (!target || target.kind === "no-published-target") {
    const unavailableReason =
      target?.reason ??
      (liveTarget?.kind === "no-published-target"
        ? liveTarget.reason
        : "registry-unavailable");
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
