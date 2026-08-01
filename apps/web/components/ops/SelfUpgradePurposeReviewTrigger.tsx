"use client";

import { useMemo } from "react";

import SelfUpgradeTriggerControl, {
  type SelfUpgradeControlActions,
} from "@/components/ops/SelfUpgradeTriggerControl";
import {
  resolveSelfUpgradePurposeBlocker,
  resolveSelfUpgradePurposeRecovery,
} from "@/lib/self-upgrade/purpose-scenario";
import {
  buildSelfUpgradePurposeReviewStatus,
  type SelfUpgradePurposeReviewState,
} from "@/lib/ux-budget/self-upgrade-purpose-review";

export function SelfUpgradePurposeReviewTrigger({
  state,
  triggerOutcome,
}: {
  state: SelfUpgradePurposeReviewState;
  triggerOutcome: "success" | "error";
}) {
  const status = buildSelfUpgradePurposeReviewStatus(state);
  const recovery = resolveSelfUpgradePurposeRecovery(status);
  const actions = useMemo<SelfUpgradeControlActions>(
    () => ({
      trigger: async () =>
        triggerOutcome === "success"
          ? { queued: true as const, runId: "SUR-PURPOSE-SUCCESS" }
          : {
              queued: false as const,
              reason: "purpose-review-rejection",
              runId: "SUR-PURPOSE-ERROR",
            },
      force: async () => ({ ok: true }),
      abort: async () => ({ ok: true }),
    }),
    [triggerOutcome],
  );

  return (
    <SelfUpgradeTriggerControl
      enabled={status.enabled}
      channel="stable"
      latestRun={status.latestRun}
      jobEngine={
        status.jobEngine
          ? {
              status: status.jobEngine.status,
              detail: null,
              checkedAt: null,
            }
          : undefined
      }
      purposeState={state}
      blockerReason={resolveSelfUpgradePurposeBlocker(status)}
      recoveryHref={recovery.href}
      recoveryLabel={recovery.label}
      actions={actions}
    />
  );
}
