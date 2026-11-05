"use client";

// BI-EF1AC111 (AC-3): the Upgrade Center line for a maintenance window that
// went without an upgrade check. The operator reads it, so the scheduler's
// reason code is put in plain words; an unknown code is shown as recorded.

import { LocalTime } from "@/components/ui/LocalTime";
import { useT } from "@/lib/i18n/use-t";

export type MissedWindow = { reason: string; at: string };

type T = ReturnType<typeof useT<"upgrade">>;

export function missedWindowCode(reason: string): string {
  return reason.split(":")[0]?.trim() || reason;
}

export function describeMissedWindowReason(t: T, reason: string): string {
  switch (missedWindowCode(reason)) {
    case "active-run": return t("missedWindow.activeRun");
    case "cooldown": return t("missedWindow.cooldown");
    case "interval-not-elapsed": return t("missedWindow.intervalNotElapsed");
    case "promoter-unavailable": return t("missedWindow.promoterUnavailable");
    case "unsupported-install-mode": return t("missedWindow.unsupported");
    default: return t("missedWindow.other", { reason });
  }
}

export function MissedWindowNotice({ missedWindow }: { missedWindow?: MissedWindow | null }) {
  const t = useT("upgrade");
  if (!missedWindow) return null;
  return (
    <div className="mt-1 text-[var(--dpf-warning)]" data-missed-window={missedWindowCode(missedWindow.reason)}>
      {t("missedWindow.heading")} <LocalTime className="font-mono" value={missedWindow.at} />.{" "}
      {describeMissedWindowReason(t, missedWindow.reason)}
    </div>
  );
}
