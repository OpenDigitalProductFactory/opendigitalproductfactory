import { getWorkCaseAction } from "@/lib/work-management/action-registry";
import type { WorkCaseActionVerb } from "@/lib/work-management/case-types";
import type { WorkCaseStagedTransitionProjection } from "@/lib/work-management/staged-transition";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringField(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function parseSourceRef(value: unknown): WorkCaseStagedTransitionProjection["sourceRef"] | null {
  if (!isRecord(value)) return null;
  const kind = stringField(value, "kind");
  const id = stringField(value, "id");
  if (
    kind !== "source" &&
    kind !== "work-item" &&
    kind !== "work-capsule" &&
    kind !== "decision-interaction" &&
    kind !== "runtime-verification" &&
    kind !== "evidence"
  ) {
    return null;
  }
  if (!id) return null;
  return {
    kind,
    id,
    status: stringField(value, "status") ?? undefined,
    sourceType: stringField(value, "sourceType") ?? undefined,
  };
}

export function parseWorkCaseStagedTransitionProjection(
  value: unknown,
): WorkCaseStagedTransitionProjection | null {
  if (!isRecord(value)) return null;
  const transitionId = stringField(value, "transitionId");
  const action = getWorkCaseAction(stringField(value, "action"))?.action as WorkCaseActionVerb | undefined;
  const sourceRef = parseSourceRef(value.sourceRef);
  const status = stringField(value, "status");
  const caseState = stringField(value, "caseState");
  const a2aStatus = stringField(value, "a2aStatus");
  const reason = stringField(value, "reason");
  const nextAction = stringField(value, "nextAction");
  if (
    !transitionId ||
    !action ||
    !sourceRef ||
    !status ||
    !caseState ||
    !a2aStatus ||
    typeof value.terminal !== "boolean" ||
    typeof value.committable !== "boolean" ||
    !reason ||
    !nextAction
  ) {
    return null;
  }
  if (
    status !== "proposed" &&
    status !== "awaiting-approval" &&
    status !== "edited" &&
    status !== "approved" &&
    status !== "rejected" &&
    status !== "responded" &&
    status !== "cancelled"
  ) {
    return null;
  }
  if (
    caseState !== "intake" &&
    caseState !== "triage" &&
    caseState !== "active" &&
    caseState !== "waiting-on-person" &&
    caseState !== "waiting-on-system" &&
    caseState !== "awaiting-decision" &&
    caseState !== "verifying" &&
    caseState !== "resolved" &&
    caseState !== "closed" &&
    caseState !== "cancelled"
  ) {
    return null;
  }
  if (
    a2aStatus !== "submitted" &&
    a2aStatus !== "working" &&
    a2aStatus !== "input-required" &&
    a2aStatus !== "auth-required" &&
    a2aStatus !== "completed" &&
    a2aStatus !== "canceled" &&
    a2aStatus !== "failed" &&
    a2aStatus !== "rejected"
  ) {
    return null;
  }
  return {
    transitionId,
    action,
    status,
    caseState,
    a2aStatus,
    terminal: value.terminal,
    committable: value.committable,
    sourceRef,
    reason,
    nextAction,
  };
}
