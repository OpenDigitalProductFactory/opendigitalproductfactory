// BI-EF1AC111 (AC-3): the Upgrade Center line for a maintenance window that
// went without an upgrade check. The operator reads it, so the scheduler's
// reason code is put in plain words; an unknown code is shown as recorded.

import { LocalTime } from "@/components/ui/LocalTime";

export type MissedWindow = { reason: string; at: string };

const MISSED_WINDOW_REASONS: Record<string, string> = {
  "active-run": "another upgrade was still running",
  cooldown: "a recent upgrade attempt was still in its wait period",
  "interval-not-elapsed": "the configured check interval had not passed yet",
  "promoter-unavailable": "the upgrade helper was not available",
  "unsupported-install-mode": "this install cannot upgrade itself",
};

export function missedWindowCode(reason: string): string {
  return reason.split(":")[0]?.trim() || reason;
}

export function describeMissedWindowReason(reason: string): string {
  return MISSED_WINDOW_REASONS[missedWindowCode(reason)] ?? `the scheduler declined (${reason})`;
}

export function MissedWindowNotice({ missedWindow }: { missedWindow?: MissedWindow | null }) {
  if (!missedWindow) return null;
  return (
    <div className="mt-1 text-[var(--dpf-warning)]" data-missed-window={missedWindowCode(missedWindow.reason)}>
      The maintenance window at <LocalTime className="font-mono" value={missedWindow.at} /> passed without an
      upgrade check: {describeMissedWindowReason(missedWindow.reason)}.
    </div>
  );
}
