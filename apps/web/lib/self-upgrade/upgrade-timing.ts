// apps/web/lib/self-upgrade/upgrade-timing.ts
//
// BI-2128872C — "nightly window only". Decides WHEN a requested self-upgrade
// runs, by who asked:
//
//   - An agent (MCP tool, in-portal coworker, external session, or a browser
//     signed in as the platform automation persona) is a ROUTINE requester. Inside
//     the maintenance window it runs now; outside it, or during an operator
//     blackout, the request is deferred to the next window and the answer says
//     when that is.
//   - A human operator pressing "Upgrade now" has explicitly chosen this moment
//     and runs immediately; when that is outside the window the run's trigger
//     records the bypass, so the run history and the change record show it.
//
// The window itself comes from effective-window.ts, so the time promised here is
// the one the status panel shows and the scheduled cron applies.

import { AUTOMATION_PERSONA_EMAIL } from "@/lib/govern/automation-sign-in";
import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import type { SelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { recordDeferredUpgradeRequest } from "@/lib/self-upgrade/deferred-request";
import { resolveEffectiveUpgradeWindow } from "@/lib/self-upgrade/effective-window";
import { computeNextScheduledUpgradeCheckAt } from "@/lib/self-upgrade/next-check";

export type UpgradeRequesterKind = "human" | "agent";

/**
 * A portal session belongs to an agent when it is the platform automation
 * persona — the identity every agent-driven browser session is minted under
 * (issue_ux_verification_sign_in). Every other signed-in user is a human.
 */
export function portalRequesterKind(email: string | null | undefined): UpgradeRequesterKind {
  return email?.trim().toLowerCase() === AUTOMATION_PERSONA_EMAIL ? "agent" : "human";
}

export const WINDOW_BYPASS_TRIGGER_SUFFIX = "+outside-window";

/** The trigger a run records when an operator ran it outside the maintenance window. */
export function withWindowBypass(trigger: string): string {
  return trigger.endsWith(WINDOW_BYPASS_TRIGGER_SUFFIX) ? trigger : `${trigger}${WINDOW_BYPASS_TRIGGER_SUFFIX}`;
}

export type UpgradeDeferralReason = "outside-window" | "blackout-period";

export type UpgradeTimingDecision =
  | { kind: "run-now"; windowBypassed: boolean }
  | {
      kind: "defer";
      reason: UpgradeDeferralReason;
      /** When the window next opens (after any active blackout). */
      nextWindowStart: Date | null;
      /** When the scheduled cron is expected to pick the request up. */
      runAt: Date | null;
      blackoutUntil: Date | null;
    }
  | { kind: "needs-timezone" };

type TimingConfig = Pick<SelfUpgradeConfig, "maintenanceWindows" | "checkIntervalHours">;

export async function decideUpgradeTiming(args: {
  requester: UpgradeRequesterKind;
  config: TimingConfig;
  now: Date;
}): Promise<UpgradeTimingDecision> {
  const { requester, config, now } = args;
  const window = await resolveEffectiveUpgradeWindow({ config, now });

  if (requester === "human") {
    return { kind: "run-now", windowBypassed: window.source === "needs-timezone" || !window.open };
  }

  if (window.source === "needs-timezone") return { kind: "needs-timezone" };

  const blackout = await getActiveSelfUpgradeBlackout(now);
  if (window.open && !blackout) return { kind: "run-now", windowBypassed: false };

  let opensAt = window.open ? now : window.nextWindowStart;
  if (blackout) {
    const after = await resolveEffectiveUpgradeWindow({ config, now: blackout.endAt });
    opensAt = after.open ? blackout.endAt : after.nextWindowStart;
  }
  const runAt = opensAt
    ? computeNextScheduledUpgradeCheckAt({
        enabled: true,
        inMaintenanceWindow: false,
        nextWindowStart: opensAt,
        // A pending deferred request waives the interval throttle at the
        // window (scheduled-gate.ts), so the last check does not delay it.
        lastCheckedAt: null,
        checkIntervalHours: config.checkIntervalHours,
        now,
      })
    : null;
  return {
    kind: "defer",
    reason: blackout ? "blackout-period" : "outside-window",
    nextWindowStart: opensAt,
    runAt,
    blackoutUntil: blackout?.endAt ?? null,
  };
}

export type UpgradeDeferral = {
  reason: UpgradeDeferralReason;
  runAt: string | null;
  nextWindowStart: string | null;
  message: string;
};

function deferralMessage(decision: Extract<UpgradeTimingDecision, { kind: "defer" }>): string {
  const why = decision.reason === "blackout-period"
    ? `An operator blackout pauses upgrades until ${decision.blackoutUntil?.toISOString() ?? "it ends"}.`
    : "Agent-requested upgrades run only in the maintenance window.";
  const when = decision.runAt
    ? `The request is queued for the next window and the scheduled upgrade will pick it up at ${decision.runAt.toISOString()}, provided the release batch is still ready and no other upgrade is running.`
    : "The request is queued for the next maintenance window; no window start could be computed yet.";
  return `${why} ${when} An operator can deploy now from /ops/self-upgrade if the release is urgent.`;
}

/** Record a deferred agent request and describe when it will run. */
export async function deferUpgradeToWindow(args: {
  requestedBy: string;
  decision: Extract<UpgradeTimingDecision, { kind: "defer" }>;
  now: Date;
}): Promise<UpgradeDeferral> {
  const { decision } = args;
  const runAt = decision.runAt?.toISOString() ?? null;
  await recordDeferredUpgradeRequest({
    requestedBy: args.requestedBy,
    requestedAt: args.now.toISOString(),
    runAt,
  });
  return {
    reason: decision.reason,
    runAt,
    nextWindowStart: decision.nextWindowStart?.toISOString() ?? null,
    message: deferralMessage(decision),
  };
}

/**
 * The trigger an operator's immediate run records: unchanged inside the
 * window, tagged with the bypass outside it (AC-2).
 */
export async function operatorRunTrigger(
  trigger: string,
  config: TimingConfig,
  now: Date = new Date(),
): Promise<string> {
  const timing = await decideUpgradeTiming({ requester: "human", config, now });
  return timing.kind === "run-now" && timing.windowBypassed ? withWindowBypass(trigger) : trigger;
}
