import type { WorkCaseDetail } from "./case-types";
import {
  dedupeRoomSourceRefs,
  roomStrings,
  roomText,
} from "./room-projection-utils";
import type {
  WorkroomBoundaryGap,
  WorkroomBoundaryView,
  WorkroomContextView,
  WorkroomParticipantView,
} from "./room-types";

export type WorkroomBoundaryInput = Omit<WorkroomBoundaryView, "gaps">;

const BOUNDARY_GAP_ORDER = [
  "purpose",
  "outcome",
  "scope",
  "participants",
  "accountable",
  "authority",
  "sensitivity",
  "context",
  "measures",
  "time-boundary",
  "closure-rule",
] as const satisfies readonly WorkroomBoundaryGap[];

function timeBoundary(input: {
  detail: WorkCaseDetail;
  boundary?: Partial<WorkroomBoundaryInput>;
}): WorkroomBoundaryView["timeBoundary"] {
  return {
    dueAt: roomText(
      input.boundary?.timeBoundary?.dueAt ?? input.detail.summary.dueAt,
    ),
    reviewAt: roomText(input.boundary?.timeBoundary?.reviewAt),
    stopConditionSummary: roomText(
      input.boundary?.timeBoundary?.stopConditionSummary,
    ),
  };
}

export function buildWorkroomBoundary(input: {
  detail: WorkCaseDetail;
  boundary?: Partial<WorkroomBoundaryInput>;
  participants: readonly WorkroomParticipantView[];
  context: WorkroomContextView;
  contextProvided: boolean;
}): WorkroomBoundaryView {
  const boundary: Omit<WorkroomBoundaryView, "gaps"> = {
    purpose: roomText(input.boundary?.purpose),
    outcome: roomText(input.boundary?.outcome),
    scopeIncluded: roomStrings(input.boundary?.scopeIncluded),
    scopeExcluded: roomStrings(input.boundary?.scopeExcluded),
    accountablePrincipalRef: roomText(
      input.boundary?.accountablePrincipalRef,
    ),
    admittedRoleSummary: roomStrings(input.boundary?.admittedRoleSummary),
    authoritySummary: roomStrings(input.boundary?.authoritySummary),
    sensitivityCeiling: roomText(input.boundary?.sensitivityCeiling),
    measures: roomStrings(input.boundary?.measures),
    timeBoundary: timeBoundary(input),
    closureRuleSummary: roomText(input.boundary?.closureRuleSummary),
    sourceRefs: dedupeRoomSourceRefs(
      input.boundary?.sourceRefs ?? input.detail.summary.sourceRefs,
    ),
  };
  const missing = new Set<WorkroomBoundaryGap>();
  if (!boundary.purpose) missing.add("purpose");
  if (!boundary.outcome) missing.add("outcome");
  if (
    boundary.scopeIncluded.length === 0
    && boundary.scopeExcluded.length === 0
  ) {
    missing.add("scope");
  }
  if (input.participants.length === 0) missing.add("participants");
  if (!boundary.accountablePrincipalRef) missing.add("accountable");
  if (boundary.authoritySummary.length === 0) missing.add("authority");
  if (!boundary.sensitivityCeiling) missing.add("sensitivity");
  if (!input.contextProvided || !input.context.refs.length) missing.add("context");
  if (boundary.measures.length === 0) missing.add("measures");
  if (
    !boundary.timeBoundary.dueAt
    && !boundary.timeBoundary.reviewAt
    && !boundary.timeBoundary.stopConditionSummary
  ) {
    missing.add("time-boundary");
  }
  if (!boundary.closureRuleSummary) missing.add("closure-rule");

  return {
    ...boundary,
    gaps: BOUNDARY_GAP_ORDER.filter((gap) => missing.has(gap)),
  };
}
