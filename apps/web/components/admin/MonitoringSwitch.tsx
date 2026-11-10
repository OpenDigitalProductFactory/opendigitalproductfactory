"use client";

// BI-8BBFE50B: the one control on /admin/settings/monitoring. It asks the
// governed `requestMonitoringChange` server action to turn monitoring on or
// off; the action re-checks manage_platform and admission and builds a
// reconciliation-mode transition from the observed host and database
// baselines (BI-F0C2E8F5). When only the monitoring record disagrees with what
// is running, the button offers to match the record to the host instead of
// flipping it. No dialog: the button names the action exactly, and each result
// maps to plain copy (monitoring-transition-outcome.ts). Copy lives in the
// "admin" catalog under monitoringSettings; the page provides that namespace.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@dpf/i18n";

import { Button } from "@/components/ui/Button";
import { requestMonitoringChange } from "@/lib/actions/runtime-capabilities";
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
  /** Install-state enables monitoring (the host's truth). */
  enabled: boolean;
  /** The monitoring record disagrees with the host; the button matches it. */
  recordMismatch?: boolean;
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

function buttonLabel(enabled: boolean, recordMismatch: boolean): MessageKey<"admin"> {
  if (recordMismatch) return enabled ? "monitoringSettings.reconcileOn" : "monitoringSettings.reconcileOff";
  return enabled ? "monitoringSettings.turnOff" : "monitoringSettings.turnOn";
}

export function MonitoringSwitch({ enabled, recordMismatch = false, canToggle, reasonKey, reasonArgs }: MonitoringSwitchProps) {
  const t = useT("admin");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<MonitoringTransitionOutcome | null>(null);

  const toggle = () => {
    const transitionId = newMonitoringTransitionId();
    // Matching the record keeps the host as it is; otherwise flip it.
    const turnOn = recordMismatch ? enabled : !enabled;
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await requestMonitoringChange({ transitionId, turnOn });
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
        variant={enabled || recordMismatch ? "secondary" : "primary"}
        onClick={toggle}
        disabled={!canToggle || isPending}
        aria-busy={isPending}
        aria-describedby={!canToggle && reasonKey ? "monitoring-switch-reason" : undefined}
      >
        {isPending ? t("monitoringSettings.working") : t(buttonLabel(enabled, recordMismatch))}
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
