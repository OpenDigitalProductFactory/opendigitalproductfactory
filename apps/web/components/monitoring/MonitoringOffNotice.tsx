"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n/use-t";

// Shown wherever metrics would render when monitoring is switched off on this
// install (BI-2CE9CBF4), so a deliberate choice never reads as an outage.
export const MONITORING_SETTINGS_HREF = "/platform/ai/runtime-health";

export function MonitoringOffNotice({ compact = false }: { compact?: boolean }) {
  const t = useT("shell");
  if (compact) {
    return (
      <p className="text-xs text-[var(--dpf-muted)]">
        {t("monitoring.offLabel")}.{" "}
        <Link href={MONITORING_SETTINGS_HREF} className="text-[var(--dpf-accent)] hover:underline">
          {t("monitoring.offLink")}
        </Link>
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-center space-y-2">
      <p className="text-sm text-[var(--dpf-text)] font-medium">{t("monitoring.offLabel")}</p>
      <p className="text-xs text-[var(--dpf-muted)]">{t("monitoring.offBody")}</p>
      <Link href={MONITORING_SETTINGS_HREF} className="text-xs text-[var(--dpf-accent)] hover:underline">
        {t("monitoring.offLink")}
      </Link>
    </div>
  );
}
