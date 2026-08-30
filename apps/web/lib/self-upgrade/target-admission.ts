import type { SelfUpgradeTargetBinding } from "./admission";
import { verifySelfUpgradeTargetBinding } from "./target-binding";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

type SelectionInput = Readonly<{
  targetBinding?: string;
  supportTargetKind: "git-source" | "release-artifact" | null;
  resolvedTarget: SelfUpgradeTargetBinding | null;
}>;

export function selectSelfUpgradeAdmissionTarget(
  input: SelectionInput,
): ActionResult<SelfUpgradeTargetBinding> {
  // Always execute the authentication boundary. A client-controlled token may
  // influence verification data, but it must never decide whether verification
  // itself runs (CodeQL: user-controlled bypass of security check).
  const bindingToken = input.targetBinding ?? "";
  const verified = verifySelfUpgradeTargetBinding(bindingToken);
  if (bindingToken && !verified.ok) return err("target-binding-invalid");

  const boundTarget = verified.ok ? verified.data : null;
  if (
    boundTarget &&
    input.resolvedTarget &&
    (boundTarget.targetKind !== input.resolvedTarget.targetKind ||
      boundTarget.targetSha.toLowerCase() !== input.resolvedTarget.targetSha.toLowerCase() ||
      boundTarget.targetTag !== input.resolvedTarget.targetTag)
  ) {
    return err("target-changed");
  }

  const target = input.resolvedTarget ?? (
    input.supportTargetKind === "release-artifact" ? boundTarget : null
  );
  return target ? ok(target) : err("target-unavailable");
}
