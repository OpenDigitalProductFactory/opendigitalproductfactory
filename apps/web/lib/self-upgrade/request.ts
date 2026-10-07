import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { resolveReleaseBatchStatus } from "@/lib/self-upgrade/release-batch-status";
import { getLatestRun } from "@/lib/self-upgrade/run-store";
import {
  admitSelfUpgrade,
  resolveCurrentSelfUpgradeTarget,
} from "@/lib/self-upgrade/admission";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";
import {
  decideUpgradeTiming,
  deferUpgradeToWindow,
  withWindowBypass,
  type UpgradeDeferralReason,
  type UpgradeRequesterKind,
} from "@/lib/self-upgrade/upgrade-timing";

type RequestActorKind = UpgradeRequesterKind;

type RequestSelfUpgradeInput = {
  requestedBy: string;
  actorKind: RequestActorKind;
  now?: Date;
};

export type RequestSelfUpgradeResult =
  | {
      success: true;
      status: "queued";
      runId: string;
      triggeredBy: string;
      eventIds: string[];
      dispatchStatus:
        | "admission_pending"
        | "dispatching"
        | "dispatched"
        | "indeterminate"
        | "dispatch_failed";
    }
  | {
      success: true;
      status: "already_active";
      runId: string;
    }
  | {
      success: true;
      /**
       * BI-2128872C: an agent asked outside the maintenance window (or during an
       * operator blackout). Nothing runs now; the request is recorded and the
       * scheduled upgrade picks it up at `runAt`.
       */
      status: "deferred_to_window";
      reason: UpgradeDeferralReason;
      runAt: string | null;
      nextWindowStart: string | null;
      message: string;
    }
  | {
      success: true;
      status: "human_override_required";
      reason: "no-window-needs-timezone" | "terminal-recovery-needs-operator-binding";
      message: string;
    }
  | {
      success: true;
      status: "batch_below_threshold";
      message: string;
      /** Merged upstream PRs accumulated so far, or null when uncomputable. */
      pendingPrCount: number | null;
      /** Batch size a routine upgrade waits for. */
      batchMinPendingPrs: number;
      /** Bounded-staleness valve (hours); 0 = disabled. */
      batchMaxWaitHours: number;
      /** ISO time of the oldest pending merged commit, or null. */
      oldestPendingAt: string | null;
    }
  | {
      success: true;
      status: "unsupported_install_mode";
      reason: "install-identity-unverified";
      targetKind: "unknown";
      message: string;
    }
  | {
      success: false;
      status: "dispatch_failed";
      runId: string;
      message: string;
    };

const ACTIVE_RUN_STATUSES = new Set(["running", "queued", "pending"]);

const NEEDS_TIMEZONE_MESSAGE =
  "Self-upgrade cannot determine a safe off-hours window because the install needs a timezone. Use /ops/self-upgrade for a human override.";

export async function requestSelfUpgrade(
  input: RequestSelfUpgradeInput,
): Promise<RequestSelfUpgradeResult> {
  const requestedBy = input.requestedBy.trim() || input.actorKind;
  const now = input.now ?? new Date();
  const latestRun = await getLatestRun();
  if (latestRun && ACTIVE_RUN_STATUSES.has(String(latestRun.status))) {
    return {
      success: true,
      status: "already_active",
      runId: latestRun.runId,
    };
  }
  if (latestRun?.status === "failed") {
    return {
      success: true,
      status: "human_override_required",
      reason: "terminal-recovery-needs-operator-binding",
      message: "A terminal upgrade can only be recovered from the operator page with the current authenticated release binding.",
    };
  }

  const config = await getSelfUpgradeConfig();
  const support = await readSelfUpgradeSupport(config.enabled);
  if (!support.supported) {
    return {
      success: true,
      status: "unsupported_install_mode",
      reason: support.reason,
      targetKind: support.targetKind,
      message: support.message,
    };
  }

  const timing = await decideUpgradeTiming({ requester: input.actorKind, config, now });
  if (timing.kind === "needs-timezone") {
    return {
      success: true,
      status: "human_override_required",
      reason: "no-window-needs-timezone",
      message: NEEDS_TIMEZONE_MESSAGE,
    };
  }

  if (input.actorKind === "agent") {
    // Release batching: an agent request is a ROUTINE trigger, so it waits for
    // the batch like the scheduled cron does — one merged PR must not drain the
    // portal on its own. Answer with the tally so the agent knows more PRs are
    // still to be tallied and can defer live validation until the batch
    // deploys (or an operator overrides via /ops/self-upgrade). Checked before
    // deferral: a request the batch would decline at the window is not queued.
    const batch = await resolveReleaseBatchStatus({
      fresh: true,
      now: input.now,
      config,
      support,
    });
    if (batch.applicable && !batch.eligible) {
      return {
        success: true,
        status: "batch_below_threshold",
        message: `${batch.summary} The routine upgrade will run once the batch is ready; wait for it before validating live, or ask the operator to use /ops/self-upgrade to deploy now.`,
        pendingPrCount: batch.pendingCount,
        batchMinPendingPrs: batch.minPendingPrs,
        batchMaxWaitHours: batch.maxWaitHours,
        oldestPendingAt: batch.oldestPendingAt?.toISOString() ?? null,
      };
    }
  }

  // BI-2128872C AC-1: an agent outside the window is queued for the next one.
  if (timing.kind === "defer") {
    const deferral = await deferUpgradeToWindow({ requestedBy, decision: timing, now });
    return { success: true, status: "deferred_to_window", ...deferral };
  }

  // AC-2: an operator outside the window runs now; the trigger records the bypass.
  const triggeredBy = timing.windowBypassed ? withWindowBypass(requestedBy) : requestedBy;

  const target = await resolveCurrentSelfUpgradeTarget();
  if (!target) {
    return {
      success: true,
      status: "unsupported_install_mode",
      reason: "install-identity-unverified",
      targetKind: "unknown",
      message: "Self-upgrade could not resolve an immutable target.",
    };
  }
  const admission = await admitSelfUpgrade({
    triggeredBy,
    target,
    requestedForce: false,
    dryRun: false,
    routine: input.actorKind === "agent",
    impactSummaryId: null,
  });
  if (!admission.admitted) {
    return { success: true, status: "already_active", runId: admission.runId };
  }
  return {
    success: true,
    status: "queued",
    runId: admission.runId,
    triggeredBy,
    eventIds: [],
    dispatchStatus: admission.dispatchStatus,
  };
}
