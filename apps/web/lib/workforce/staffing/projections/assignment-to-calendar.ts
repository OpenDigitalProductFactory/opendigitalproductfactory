/**
 * Confirmed-assignment → calendar projection (EP-WORKFORCE-OPS / BI-4AD09A35
 * Phase 7). Spec §5.2 + §4: the staffing domain is authoritative; the calendar
 * is a PROJECTION. A confirmed assignment projects into a `CalendarEventView`
 * for display and free/busy — it never becomes a second canonical copy, and a
 * calendar event never establishes an assignment (the arrow points one way).
 *
 * Pure transform: staffing records in, calendar-view rows out. Only confirmed/
 * published assignments project (a proposed assignment is not on anyone's
 * calendar yet). The projection is idempotent by (organization, source
 * assignment id) so re-projecting never duplicates (spec §5.3).
 */

export type ProjectableAssignment = {
  assignmentId: string;
  employeeProfileId: string;
  lifecycle: string;
  shift: {
    shiftId: string;
    startAt: string;
    endAt: string;
    timezone: string;
    roleLabel: string | null;
    workLocationId: string | null;
  };
};

/** A read-only calendar projection of a confirmed staffing assignment. */
export type StaffingCalendarProjection = {
  /** Idempotency key — stable per source assignment (spec §5.3). */
  sourceRef: string;
  ownerEmployeeId: string;
  startAt: string;
  endAt: string;
  timezone: string;
  title: string;
  category: "staffing";
  /** Marks this as a projection, so calendar write paths never treat it as a
   *  native editable event or an assignment authority. */
  readonly: true;
};

const PROJECTABLE = new Set(["confirmed", "published", "completed", "on_site"]);

/**
 * Project the confirmed assignments in a set into calendar-view rows. Non-
 * confirmed assignments are skipped (they are not yet on a calendar). The title
 * is the shift's role label — a staffing shift is not private, but it also
 * carries no personal detail beyond the role.
 */
export function projectAssignmentsToCalendar(
  assignments: ProjectableAssignment[],
): StaffingCalendarProjection[] {
  const out: StaffingCalendarProjection[] = [];
  for (const a of assignments) {
    if (!PROJECTABLE.has(a.lifecycle)) continue;
    out.push({
      sourceRef: `staffing-assignment:${a.assignmentId}`,
      ownerEmployeeId: a.employeeProfileId,
      startAt: a.shift.startAt,
      endAt: a.shift.endAt,
      timezone: a.shift.timezone,
      title: a.shift.roleLabel ?? "Scheduled shift",
      category: "staffing",
      readonly: true,
    });
  }
  return out;
}
