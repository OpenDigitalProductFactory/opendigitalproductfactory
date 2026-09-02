import {
  loadVerifiedReleaseTargetEvidence,
  recordVerifiedReleaseTargetEvidence,
} from "@/lib/release-health/state";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  resolveReleaseTarget,
  resolveReleaseUpgradeCandidate,
  type ReleaseInstallContext,
} from "./release-target";

type VerifiedReleaseTargetInput = {
  context: ReleaseInstallContext;
  currentConfigDigest: string | null;
  log?: (message: string) => void;
};

/**
 * Resolve a release target from the registry or from recent publisher-verified
 * evidence bound to this exact install. Only transport unavailability may use
 * the bounded fallback; any registry integrity result remains authoritative.
 */
/** `registry-unavailable` alone cannot say whether the registry rate-limited us, 5xx'd, or refused the token. */
function describeUnavailable(target: { reason: string; detail?: string }): string {
  return target.detail ? `${target.reason} (${target.detail})` : target.reason;
}

export async function resolveVerifiedReleaseUpgradeCandidate(
  input: VerifiedReleaseTargetInput,
): Promise<Awaited<ReturnType<typeof resolveReleaseUpgradeCandidate>>> {
  const log = input.log ?? ((message: string) => console.warn(`[self-upgrade] ${message}`));
  const liveTarget = await resolveReleaseUpgradeCandidate({
    context: input.context,
    currentConfigDigest: input.currentConfigDigest,
  }).catch((error: unknown) => {
    log(`release-target-resolution-threw: ${getErrorMessage(error)}`);
    return null;
  });
  if (liveTarget && liveTarget.kind !== "no-published-target") {
    const { kind: _kind, ...candidate } = liveTarget;
    await recordVerifiedReleaseTargetEvidence({
      candidate,
      context: input.context,
      currentConfigDigest: input.currentConfigDigest ?? "",
    }).catch(() => false);
    return liveTarget;
  }
  if (liveTarget?.kind === "no-published-target" && liveTarget.reason !== "registry-unavailable") {
    log(`release-target-unavailable: ${describeUnavailable(liveTarget)}`);
    return liveTarget;
  }
  const persistedCandidate = input.currentConfigDigest
    ? await loadVerifiedReleaseTargetEvidence({
        context: input.context,
        currentConfigDigest: input.currentConfigDigest,
      }).catch(() => null)
    : null;
  if (!persistedCandidate) {
    const unavailable = liveTarget ?? {
      kind: "no-published-target" as const,
      reason: "registry-unavailable" as const,
    };
    log(`release-target-unavailable: ${describeUnavailable(unavailable)}`);
    return unavailable;
  }
  const target = resolveReleaseTarget({
    currentConfigDigest: input.currentConfigDigest,
    candidate: persistedCandidate,
    unavailableReason: "registry-unavailable",
  });
  if (target.kind === "no-published-target") {
    log(`release-target-unavailable: ${describeUnavailable(target)}`);
  }
  return target;
}
