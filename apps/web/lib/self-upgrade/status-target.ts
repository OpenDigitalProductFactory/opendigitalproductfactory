import type { SelfUpgradeConfig } from "./config";
import {
  loadVerifiedReleaseTargetEvidence,
  recordVerifiedReleaseTargetEvidence,
} from "@/lib/release-health/state";
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
  const liveTarget = await resolveReleaseUpgradeCandidate({
    context,
    currentConfigDigest: input.currentConfigDigest,
  }).catch(() => null);
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
    return {
      ...UNAVAILABLE,
      unavailableReason:
        target?.reason ??
        (liveTarget?.kind === "no-published-target"
          ? liveTarget.reason
          : "registry-unavailable"),
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
