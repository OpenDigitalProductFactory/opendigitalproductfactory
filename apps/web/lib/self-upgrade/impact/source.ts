import { getSelfUpgradeConfig } from "../config";
import { readSelfUpgradeSupport } from "../support";
import { resolveSelfUpgradeStatusTarget } from "../status-target";
import { readCurrentContainerConfigDigest } from "../runtime-image-identity";
import { collectChangeSet } from "./change-set";
import { collectReleaseChangeSet } from "./release-change-set";

/** One target contract for the banner, advisory summary and run linkage. */
export async function loadImpactSource() {
  const config = await getSelfUpgradeConfig();
  const support = await readSelfUpgradeSupport(config.enabled);
  const target = await resolveSelfUpgradeStatusTarget({
    support,
    config,
    currentConfigDigest: support.targetKind === "release-artifact"
      ? await readCurrentContainerConfigDigest() : null,
  });
  return {
    targetSha: target.targetSha,
    unavailableReason: target.unavailableReason,
    collect: (input: { currentLineageSha: string; targetSha: string }) =>
      support.targetKind === "release-artifact"
        ? collectReleaseChangeSet(input)
        : collectChangeSet({ ...input, config: { hostSourcePath: config.hostSourceMountPath } }),
  };
}
