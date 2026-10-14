"use client";

// BI-8BBFE50B: the one control on /admin/settings/monitoring. It asks the
// existing governed server action for a runtime capability transition with the
// current install-state key set plus or minus runtime:deep-observability; the
// action re-checks manage_platform and admission. No dialog: the button names
// the action exactly, and each coordinator result maps to plain copy
// (monitoring-transition-outcome.ts). Copy lives in the "admin" catalog under
// monitoringSettings; the page provides that namespace.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@dpf/i18n";

import { Button } from "@/components/ui/Button";
import { requestRuntimeCapabilityTransition } from "@/lib/actions/runtime-capabilities";
import { MONITORING_CAPABILITY } from "@/lib/platform-runtime/monitoring-switch-state";
import {
  mapMonitoringTransitionError,
  mapMonitoringTransitionOutcome,
  type MonitoringOutcomeTone,
  type MonitoringTransitionOutcome,
} from "@/lib/platform-runtime/monitoring-transition-outcome";
import { useT } from "@/lib/i18n/use-t";

const TONE_CLASS: Record<MonitoringOutcomeTone, string> = {
  success: "text-[var(--dpf-success)]",
  warning: "text-[var(--dpf-warning)]",
  critical: "text-[var(--dpf-error)]",
  neutral: "text-[var(--dpf-muted)]",
};

export interface MonitoringSwitchProps {
  enabled: boolean;
  enabledKeys: string[];
  canToggle: boolean;
  /** Catalog key explaining why the switch is locked, when it is. */
  reasonKey: MessageKey<"admin"> | null;
  reasonArgs?: Record<string, string>;
}

/** `RCT-` + 32 hex chars. getRandomValues, not randomUUID: installs are often
 * reached over plain http on a LAN address, where randomUUID is unavailable. */
export function newMonitoringTransitionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `RCT-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function desiredMonitoringKeys(enabledKeys: readonly string[], turnOn: boolean): string[] {
  const rest = enabledKeys.filter((key) => key !== MONITORING_CAPABILITY);
  return turnOn ? [...rest, MONITORING_CAPABILITY] : rest;
}

export function MonitoringSwitch({ enabled, enabledKeys, canToggle, reasonKey, reasonArgs }: MonitoringSwitchProps) {
  const t = useT("admin");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<MonitoringTransitionOutcome | null>(null);

  const toggle = () => {
    const transitionId = newMonitoringTransitionId();
    const desiredKeys = desiredMonitoringKeys(enabledKeys, !enabled);
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await requestRuntimeCapabilityTransition({ transitionId, desiredKeys });
        setOutcome(mapMonitoringTransitionOutcome(result, transitionId));
      } catch (error) {
        setOutcome(mapMonitoringTransitionError(error, transitionId));
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-2" data-testid="monitoring-switch">
      <Button
        variant={enabled ? "secondary" : "primary"}
        onClick={toggle}
        disabled={!canToggle || isPending}
        aria-busy={isPending}
        aria-describedby={!canToggle && reasonKey ? "monitoring-switch-reason" : undefined}
      >
        {isPending ? t("monitoringSettings.working") : t(enabled ? "monitoringSettings.turnOff" : "monitoringSettings.turnOn")}
      </Button>
      {!canToggle && reasonKey && (
        <p id="monitoring-switch-reason" className="text-xs text-[var(--dpf-muted)]">
          {t(reasonKey, reasonArgs)}
        </p>
      )}
      {outcome && (
        <p
          role={outcome.tone === "critical" ? "alert" : "status"}
          aria-live="polite"
          className={`text-sm ${TONE_CLASS[outcome.tone]}`}
          data-outcome-tone={outcome.tone}
        >
          {t(outcome.messageKey, { failure: outcome.failure ?? "", transitionId: outcome.transitionId ?? "" })}
        </p>
      )}
    </div>
  );
}
