import { inngest } from "@/lib/queue/inngest-client";
import { SELF_UPGRADE_EVENT } from "@/lib/queue/functions/self-upgrade";
import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { resolveAutoUpgradeWindow } from "@/lib/self-upgrade/auto-window";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { isUpgradeWindowOpen } from "@/lib/self-upgrade/window";
import { createRun, failRun, getLatestRun } from "@/lib/self-upgrade/run-store";

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
      success: false;
      status: "dispatch_failed";
      runId: string;
      message: string;
    };

const ACTIVE_RUN_STATUSES = new Set(["running", "queued", "pending"]);

async function agentWindowGate(
  now: Date,
): Promise<
  | { allowed: true }
  | { allowed: false; reason: "outside-window" | "no-window-needs-timezone" }
> {
  const config = await getSelfUpgradeConfig();
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

  if (input.actorKind === "agent") {
    const gate = await agentWindowGate(input.now ?? new Date());
    if (!gate.allowed) {
      return {
        success: true,
        status: "human_override_required",
        reason: gate.reason,
        message: humanOverrideMessage(gate.reason),
      };
    }
  }

  const run = await createRun({ triggeredBy });
  try {
    const result = await inngest.send({
      name: SELF_UPGRADE_EVENT,
      data: {
        runId: run.runId,
        triggeredBy,
      },
    });
    return {
      success: true,
      status: "queued",
      runId: run.runId,
      triggeredBy,
      eventIds: result.ids,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failure = `queue-dispatch-failed: ${message}`;
    await failRun(run.runId, failure);
    return {
      success: false,
      status: "dispatch_failed",
      runId: run.runId,
      message: failure,
    };
  }
}
