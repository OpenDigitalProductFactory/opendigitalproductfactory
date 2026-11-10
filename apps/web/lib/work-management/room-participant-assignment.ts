/**
 * Persisted Workroom participant assignments (BI-4CB2EF76).
 *
 * Canonical roster carrier: WorkroomParticipant rows on the Workroom
 * (WorkCapsule) substrate. Explicit assignment is distinguishable from
 * legacy WorkItem assignment and from read-model coordinator derivation.
 * Derived coordinators are never written. Participant identity may tighten
 * safety but cannot carry coworker-owned proactivity onto the room.
 */
import { isRecord } from "@/lib/shared/coerce";

import {
  WORKROOM_PARTICIPANT_ROLES,
  type WorkroomCoordinatorSource,
  type WorkroomParticipantAssignmentSource,
  type WorkroomParticipantRole,
  type WorkroomParticipantView,
} from "./room-types";
import { deriveRoomCoordinator } from "./room-coordinator";

export { WORKROOM_PARTICIPANT_ROLES };

export const PERSISTED_WORKROOM_PARTICIPANT_ASSIGNMENT_SOURCES = ["explicit", "legacy"] as const;
export type PersistedWorkroomParticipantAssignmentSource =
  (typeof PERSISTED_WORKROOM_PARTICIPANT_ASSIGNMENT_SOURCES)[number];

const PROACTIVITY_KEYS = [
  "proactivity",
  "coworkerPreference",
  "coworkerPreferences",
  "selfTasks",
  "COWORKER_SELF_TASKS",
  "agentPreference",
  "agentPreferences",
] as const;

export type PersistedWorkroomParticipantAssignment = {
  workroomId: string;
  principalRef: string;
  roles: WorkroomParticipantRole[];
  assignmentSource: PersistedWorkroomParticipantAssignmentSource;
  enteredReason: string | null;
  currentWorkSummary: string | null;
};

export type ProjectableWorkroomParticipantAssignment = PersistedWorkroomParticipantAssignment & {
  displayName: string;
  kind: WorkroomParticipantView["kind"];
  sponsorPrincipalRef: string | null;
  sponsorDisplayName: string | null;
  authoritySummary: string;
};

function isParticipantRole(value: unknown): value is WorkroomParticipantRole {
  return typeof value === "string" && (WORKROOM_PARTICIPANT_ROLES as readonly string[]).includes(value);
}

function isPersistedSource(value: unknown): value is PersistedWorkroomParticipantAssignmentSource {
  return value === "explicit" || value === "legacy";
}

export function assertAssignmentDoesNotCarryProactivity(input: Record<string, unknown>): void {
  const carried = PROACTIVITY_KEYS.filter((key) => key in input);
  if (carried.length > 0) {
    throw new Error(
      `Workroom participant assignment cannot carry coworker-owned proactivity (${carried.join(", ")}).`,
    );
  }
}

export function parsePersistedWorkroomParticipantAssignment(
  input: unknown,
): PersistedWorkroomParticipantAssignment {
  if (!isRecord(input)) {
    throw new Error("Workroom participant assignment must be an object.");
  }
  assertAssignmentDoesNotCarryProactivity(input);
  const workroomId = typeof input.workroomId === "string" ? input.workroomId.trim() : "";
  const principalRef = typeof input.principalRef === "string" ? input.principalRef.trim() : "";
  if (!workroomId) throw new Error("Workroom participant assignment requires workroomId.");
  if (!principalRef) throw new Error("Workroom participant assignment requires principalRef.");
  if (!isPersistedSource(input.assignmentSource)) {
    throw new Error("Workroom participant assignment requires assignmentSource explicit|legacy.");
  }
  const roles = Array.isArray(input.roles) ? input.roles.filter(isParticipantRole) : [];
  if (roles.length === 0) {
    throw new Error("Workroom participant assignment requires at least one canonical role.");
  }
  return {
    workroomId,
    principalRef,
    roles: [...new Set(roles)],
    assignmentSource: input.assignmentSource,
    enteredReason: typeof input.enteredReason === "string" ? input.enteredReason.trim() || null : null,
    currentWorkSummary: typeof input.currentWorkSummary === "string"
      ? input.currentWorkSummary.trim() || null
      : null,
  };
}

export function resolveCoordinatorSource(input: {
  roles: readonly WorkroomParticipantRole[];
  assignmentSource: WorkroomParticipantAssignmentSource;
  coordinatorWasDerived?: boolean;
}): WorkroomCoordinatorSource {
  if (input.coordinatorWasDerived) return "derived";
  if (input.roles.includes("coordinator")) return "explicit";
  void input.assignmentSource;
  return "none";
}

export function projectPersistedWorkroomRoster(input: {
  assignments: readonly ProjectableWorkroomParticipantAssignment[];
  presencePrincipalRefs: readonly string[];
}): WorkroomParticipantView[] {
  const active = new Set(input.presencePrincipalRefs);
  const projected: WorkroomParticipantView[] = input.assignments.map((assignment) => {
    const currentWorkSummary = assignment.currentWorkSummary;
    return {
      principalRef: assignment.principalRef,
      displayName: assignment.displayName,
      kind: assignment.kind,
      roles: [...assignment.roles],
      workState: currentWorkSummary ? "working" : "unknown",
      presence: active.has(assignment.principalRef) ? "active" : "unknown",
      currentWorkSummary,
      enteredReason: assignment.enteredReason,
      sponsorPrincipalRef: assignment.sponsorPrincipalRef,
      sponsorDisplayName: assignment.sponsorDisplayName,
      authoritySummary: assignment.authoritySummary,
      sourceRefs: [{ kind: "evidence", id: assignment.principalRef, sourceType: "principal" }],
      assignmentSource: assignment.assignmentSource,
      coordinatorSource: resolveCoordinatorSource({
        roles: assignment.roles,
        assignmentSource: assignment.assignmentSource,
      }),
    };
  });
  return deriveRoomCoordinator(projected);
}
