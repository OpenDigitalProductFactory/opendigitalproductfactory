import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { resolveAutoUpgradeWindow } from "@/lib/self-upgrade/auto-window";
import {
  getSelfUpgradeConfig,
  type SelfUpgradeConfig,
} from "@/lib/self-upgrade/config";
import { isUpgradeWindowOpen } from "@/lib/self-upgrade/window";
import { resolveReleaseBatchStatus } from "@/lib/self-upgrade/release-batch-status";
import { getLatestRun } from "@/lib/self-upgrade/run-store";
import {
  admitSelfUpgrade,
  resolveCurrentSelfUpgradeTarget,
} from "@/lib/self-upgrade/admission";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";

type RequestActorKind = "human" | "agent";

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
      status: "human_override_required";
      reason: "outside-window" | "no-window-needs-timezone";
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

async function agentWindowGate(
  now: Date,
  config: SelfUpgradeConfig,
): Promise<
  | { allowed: true }
  | { allowed: false; reason: "outside-window" | "no-window-needs-timezone" }
> {
  const { schedule, timezone, timezoneKnown, lowTrafficWindows } =
    await resolveOperatingScheduleForSystem();
  const auto =
    config.maintenanceWindows.length > 0
      ? { kind: "operating-hours" as const }
      : resolveAutoUpgradeWindow({
          schedule,
          timeZone: timezone,
          timezoneKnown,
          lowTrafficWindows,
          now,
        });

  if (auto.kind === "needs-timezone") {
    return { allowed: false, reason: "no-window-needs-timezone" };
  }

  const explicitWindows =
    config.maintenanceWindows.length > 0
      ? config.maintenanceWindows
      : auto.kind === "auto-overnight"
        ? auto.windows
        : undefined;
  const allowed = isUpgradeWindowOpen({
    explicitWindows,
    schedule,
    timeZone: timezone,
    now,
  });
  return allowed ? { allowed: true } : { allowed: false, reason: "outside-window" };
}

function humanOverrideMessage(reason: "outside-window" | "no-window-needs-timezone"): string {
  if (reason === "no-window-needs-timezone") {
    return "Self-upgrade cannot determine a safe off-hours window because the install needs a timezone. Use /ops/self-upgrade for a human override.";
  }
  return "Self-upgrade is outside the allowed maintenance window. Use /ops/self-upgrade for a human override.";
}

export async function requestSelfUpgrade(
  input: RequestSelfUpgradeInput,
): Promise<RequestSelfUpgradeResult> {
  const triggeredBy = input.requestedBy.trim() || input.actorKind;
  const latestRun = await getLatestRun();
  if (latestRun && ACTIVE_RUN_STATUSES.has(String(latestRun.status))) {
    return {
      success: true,
      status: "already_active",
      runId: latestRun.runId,
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

  if (input.actorKind === "agent") {
    const gate = await agentWindowGate(input.now ?? new Date(), config);
    if (!gate.allowed) {
      return {
        success: true,
        status: "human_override_required",
        reason: gate.reason,
        message: humanOverrideMessage(gate.reason),
      };
    }

    // Release batching: an agent request is a ROUTINE trigger, so it waits for
    // the batch like the scheduled cron does — one merged PR must not drain the
    // portal on its own. Answer with the tally so the agent knows more PRs are
    // still to be tallied and can defer live validation until the batch
    // deploys (or an operator overrides via /ops/self-upgrade).
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
