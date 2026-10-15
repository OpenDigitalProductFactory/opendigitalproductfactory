// BI-8BBFE50B: plain copy for every result of a monitoring on/off request.
//
// `coordinateRuntimeCapabilityTransition` (transition-coordinator.ts) returns
// one of: succeeded, host_applied_pending_verification, transition_in_progress,
// drain_required, already_terminal, failed, rolled_back, rollback_failed. The
// executor can also return transition_in_progress before the coordinator runs,
// and the server action can throw on admission. Each maps to a tone and an
// `admin` catalog key; the failure kinds keep the reason and transition id so
// the operator can quote them.

import type { MessageKey } from "@dpf/i18n";

import { isCapabilityStateStaleError } from "./capability-state-divergence";

export type MonitoringOutcomeTone = "success" | "warning" | "critical" | "neutral";

export interface MonitoringTransitionOutcome {
  tone: MonitoringOutcomeTone;
  messageKey: MessageKey<"admin">;
  failure?: string;
  transitionId?: string;
}

type CoordinatorResult = { status: string; failure?: string } | null | undefined;

export function mapMonitoringTransitionOutcome(result: CoordinatorResult, transitionId: string): MonitoringTransitionOutcome {
  const failure = result?.failure;
  switch (result?.status) {
    case "succeeded":
      return { tone: "success", messageKey: "monitoringSettings.outcome.succeeded" };
    case "host_applied_pending_verification":
      return { tone: "warning", messageKey: "monitoringSettings.outcome.pendingVerification", transitionId };
    case "transition_in_progress":
      return { tone: "neutral", messageKey: "monitoringSettings.outcome.inProgress" };
    case "drain_required":
      return { tone: "warning", messageKey: "monitoringSettings.outcome.drainRequired" };
    case "already_terminal":
      return { tone: "neutral", messageKey: "monitoringSettings.outcome.alreadyTerminal", transitionId };
    case "failed":
      return { tone: "critical", messageKey: "monitoringSettings.outcome.failed", failure: failure ?? "unknown", transitionId };
    case "rolled_back":
      return { tone: "warning", messageKey: "monitoringSettings.outcome.rolledBack", failure: failure ?? "unknown", transitionId };
    case "rollback_failed":
      return { tone: "critical", messageKey: "monitoringSettings.outcome.rollbackFailed", failure: failure ?? "unknown", transitionId };
    default:
      return { tone: "critical", messageKey: "monitoringSettings.outcome.unknown", transitionId };
  }
}

/** A thrown request (admission refusal, stale state, host misconfiguration). */
export function mapMonitoringTransitionError(error: unknown, transitionId: string): MonitoringTransitionOutcome {
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  if (message === "runtime_capability_reconciliation_in_progress") {
    return { tone: "neutral", messageKey: "monitoringSettings.outcome.inProgress" };
  }
  if (message === "runtime_capability_recovery_required") {
    return { tone: "critical", messageKey: "monitoringSettings.outcome.recoveryRequired" };
  }
  if (isCapabilityStateStaleError(error)) {
    return { tone: "warning", messageKey: "monitoringSettings.outcome.unreconciled" };
  }
  return { tone: "critical", messageKey: "monitoringSettings.outcome.failed", failure: message, transitionId };
}
