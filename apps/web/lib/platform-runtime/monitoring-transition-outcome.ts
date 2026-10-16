// BI-8BBFE50B: plain copy for every result of a monitoring on/off request.
//
// `coordinateRuntimeCapabilityTransition` (transition-coordinator.ts) returns
// one of: succeeded, host_applied_pending_verification, transition_in_progress,
// drain_required, already_terminal, failed, rolled_back, rollback_failed. The
// executor can also return transition_in_progress before the coordinator runs,
// or a reconciliation failure code. The monitoring server action returns
// admission refusals as `failed` results rather than throwing, because Next
// hides a thrown server-action message in production (BI-F0C2E8F5). Each maps
// to a tone and an `admin` catalog key; the generic failure kinds keep the
// reason and transition id so the operator can quote them.

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

/** Failure codes with their own plain copy instead of the generic failure line. */
const KNOWN_FAILURES: Readonly<Record<string, Pick<MonitoringTransitionOutcome, "tone" | "messageKey">>> = {
  runtime_capability_reconciliation_in_progress: { tone: "neutral", messageKey: "monitoringSettings.outcome.inProgress" },
  runtime_capability_recovery_required: { tone: "critical", messageKey: "monitoringSettings.outcome.recoveryRequired" },
  runtime_reconciliation_host_stale: { tone: "warning", messageKey: "monitoringSettings.outcome.hostStale" },
  runtime_reconciliation_database_stale: { tone: "warning", messageKey: "monitoringSettings.outcome.databaseStale" },
  runtime_reconciliation_request_mismatch: { tone: "warning", messageKey: "monitoringSettings.outcome.requestMismatch" },
  runtime_reconciliation_protocol_unavailable: { tone: "critical", messageKey: "monitoringSettings.outcome.protocolUnavailable" },
};

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
      if (failure && Object.hasOwn(KNOWN_FAILURES, failure)) return { ...KNOWN_FAILURES[failure]!, transitionId };
      return { tone: "critical", messageKey: "monitoringSettings.outcome.failed", failure: failure ?? "unknown", transitionId };
    case "rolled_back":
      return { tone: "warning", messageKey: "monitoringSettings.outcome.rolledBack", failure: failure ?? "unknown", transitionId };
    case "rollback_failed":
      return { tone: "critical", messageKey: "monitoringSettings.outcome.rollbackFailed", failure: failure ?? "unknown", transitionId };
    default:
      return { tone: "critical", messageKey: "monitoringSettings.outcome.unknown", transitionId };
  }
}

/** A request that threw before returning (network loss, authentication, or an
 * older server that still throws admission refusals). */
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
