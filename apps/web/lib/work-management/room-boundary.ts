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
import type { WorkroomBoundaryClaim } from "./workroom-boundary-claim";

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

/**
 * Project a room's DECLARED boundary claim into the boundary input this module
 * assembles from.
 *
 * Spec: 2026-07-26-work-rooms-collaboration-design.md §7 — the eleven-part
 * boundary, and §7.2 boundary repair. Before the claim existed every field here
 * was hardcoded null in workspace-case-loader.ts, so the gap list could never be
 * satisfied on any install.
 *
 * A declared boundary wins, exactly as a declared shape does. Nothing is
 * INFERRED: an unstated outcome stays null, because the gap list exists to tell
 * a room nobody has bounded from one somebody has.
 */
export function projectDeclaredBoundary(input: {
  claim: WorkroomBoundaryClaim | null;
  fallbackPurpose?: string | null;
  dueAt?: string | null;
  sourceRefs: WorkroomBoundaryInput["sourceRefs"];
}): WorkroomBoundaryInput {
  const claim = input.claim;
  return {
    purpose: claim?.purpose ?? input.fallbackPurpose ?? null,
    outcome: claim?.outcome ?? null,
    scopeIncluded: [...(claim?.scopeIncluded ?? [])],
    scopeExcluded: [...(claim?.scopeExcluded ?? [])],
    accountablePrincipalRef: claim?.accountablePrincipalRef ?? null,
    admittedRoleSummary: [],
    authoritySummary: [...(claim?.authoritySummary ?? [])],
    sensitivityCeiling: claim?.sensitivityCeiling ?? null,
    measures: [...(claim?.measures ?? [])],
    timeBoundary: {
      dueAt: input.dueAt ?? null,
      reviewAt: null,
      stopConditionSummary: claim?.closureRuleSummary ?? null,
    },
    closureRuleSummary: claim?.closureRuleSummary ?? null,
    sourceRefs: input.sourceRefs,
  };
}
