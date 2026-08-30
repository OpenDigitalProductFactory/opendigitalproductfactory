import type { WorkerClassification } from "@dpf/db";
import type { ProfessionJurisdiction } from "@dpf/db/wiki-taxonomy";

import type { EmploymentEventType } from "./workforce-types";

/**
 * The employment event actuator (BI-2624B7EA) — the single edge EP-862820FD
 * exists to build.
 *
 * `EmploymentEvent` has been a closed 16-value union guarded by
 * `LIFECYCLE_TRANSITION_MATRIX` with ZERO subscribers: a log, not a trigger.
 * Hiring someone appended a row and created checklist items a human then worked
 * by hand. This is the subscriber.
 *
 * ## What it is not
 *
 * It is NOT a second state machine. `LIFECYCLE_TRANSITION_MATRIX` remains the
 * sole authority on which transitions are legal; this reads an event that has
 * already been validated and decides what work it should open. It never
 * re-validates and never re-decides the transition.
 *
 * It is NOT a workflow engine. The five Workroom definitions registered in
 * `WORK_CASE_SOURCE_REGISTRY` (BI-28EFA338) already declare outcome, trigger
 * classes, authority, review, escalation and completion rules. This maps an
 * event onto one of them.
 *
 * ## Why every event needs an explicit disposition
 *
 * An actuator whose new event types silently do nothing degrades back into the
 * log it replaced. So each of the 16 values resolves to `spawn`, `update`, or
 * `inert` WITH A RECORDED REASON — never unhandled by omission. The
 * exhaustiveness is enforced twice: `Record<EmploymentEventType, ...>` makes a
 * missing key a compile error, and a test walks the union at runtime.
 */

/** The Workroom definition keys this actuator spawns, from `WORK_CASE_SOURCE_REGISTRY`. */
export type EmploymentWorkroomKey =
  | "worker-onboarding"
  | "worker-change"
  | "worker-offboarding";

export type EventDisposition =
  | { readonly kind: "spawn"; readonly definitionKey: EmploymentWorkroomKey }
  /**
   * The event belongs to an instance that is already open. Opening a second room
   * for a worker going on leave would fragment one engagement across many rooms.
   */
  | { readonly kind: "update"; readonly definitionKey: EmploymentWorkroomKey; readonly reason: string }
  /** Deliberately does nothing, and says why. */
  | { readonly kind: "inert"; readonly reason: string };

/**
 * Every `EmploymentEventType`, mapped. `Record` over the union means removing a
 * value here, or adding one to the union without adding it here, fails to
 * compile — the disposition cannot be forgotten.
 */
export const EVENT_DISPOSITIONS: Readonly<Record<EmploymentEventType, EventDisposition>> = {
  // ── Joining ────────────────────────────────────────────────────────────────
  hired: { kind: "spawn", definitionKey: "worker-onboarding" },
  offer_accepted: { kind: "spawn", definitionKey: "worker-onboarding" },
  onboarding_started: { kind: "spawn", definitionKey: "worker-onboarding" },

  // ── Moving ─────────────────────────────────────────────────────────────────
  manager_changed: { kind: "spawn", definitionKey: "worker-change" },
  department_changed: { kind: "spawn", definitionKey: "worker-change" },
  position_changed: { kind: "spawn", definitionKey: "worker-change" },

  // ── Leaving ────────────────────────────────────────────────────────────────
  offboarding_started: { kind: "spawn", definitionKey: "worker-offboarding" },
  terminated: { kind: "spawn", definitionKey: "worker-offboarding" },

  // ── Reaching an already-open room ──────────────────────────────────────────
  leave_started: {
    kind: "update",
    definitionKey: "worker-change",
    reason: "Leave is a state of an existing engagement, not a new piece of work.",
  },
  leave_ended: {
    kind: "update",
    definitionKey: "worker-change",
    reason: "Returning from leave resolves the same engagement the leave opened.",
  },
  activated: {
    kind: "update",
    definitionKey: "worker-onboarding",
    reason: "Activation is the outcome onboarding was opened to reach.",
  },
  reactivated: {
    kind: "update",
    definitionKey: "worker-onboarding",
    reason: "A returning worker resumes the onboarding room rather than opening a rival one.",
  },
  onboarding_completed: {
    kind: "update",
    definitionKey: "worker-onboarding",
    reason:
      "Signals completion to the open room; the room's own completion rules decide whether it may close, so an outstanding provisioning step still holds it open.",
  },
  offboarding_completed: {
    kind: "update",
    definitionKey: "worker-offboarding",
    reason:
      "Signals completion to the open room. It must NOT close it directly — an offboarding that closes while a dated revocation is outstanding is the failure this epic most needs to prevent.",
  },

  // ── Deliberately inert ─────────────────────────────────────────────────────
  offer_created: {
    kind: "inert",
    reason:
      "An offer is a candidate document, not yet a worker relationship. Onboarding opens on acceptance; opening it here would provision someone who may never join.",
  },
  offer_withdrawn: {
    kind: "inert",
    reason:
      "Nothing was spawned for an unaccepted offer, so there is nothing to open or close. Withdrawal is recorded on the offer itself.",
  },
};

/** Why an event could not produce an instance. */
export type ActuationRefusalReason =
  | "classification-unresolved"
  | "jurisdiction-unresolved";

export type ActuationOutcome =
  | {
      readonly kind: "spawn";
      readonly definitionKey: EmploymentWorkroomKey;
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: "update";
      readonly definitionKey: EmploymentWorkroomKey;
      readonly idempotencyKey: string;
      readonly reason: string;
    }
  | { readonly kind: "inert"; readonly reason: string }
  /**
   * Named operator work. NOT a partial instance: a half-provisioned worker is
   * worse than an unprovisioned one, because the organisation believes
   * onboarding happened and the missing half is discovered by the worker on
   * their first day, or by an auditor.
   */
  | {
      readonly kind: "operator-work";
      readonly reason: ActuationRefusalReason;
      readonly message: string;
    };

export type EmploymentEventInput = {
  /** Stable id of the `EmploymentEvent` row. Anchors idempotency. */
  readonly employmentEventId: string;
  readonly eventType: EmploymentEventType;
  readonly employeeProfileId: string;
  /** Null means unresolved — never assume `employee`. */
  readonly classification: WorkerClassification | null;
  /** Null means unresolved — never assume `global`. */
  readonly jurisdiction: ProfessionJurisdiction | null;
};

/**
 * The idempotency key for an (event, definition) pair.
 *
 * Written to `Workroom.idempotencyKey`, which already carries a unique
 * constraint — so event replay and two writers racing the same transition both
 * yield exactly one instance, enforced by the database rather than by a
 * read-then-write check that a race can straddle.
 */
export function actuationIdempotencyKey(
  employmentEventId: string,
  definitionKey: EmploymentWorkroomKey,
): string {
  return `employment-event:${employmentEventId}:${definitionKey}`;
}

/**
 * Decide what an employment event should actuate.
 *
 * Pure: no database, no clock, no side effects. The caller performs the write
 * under the unique constraint, so this stays exhaustively testable.
 */
export function planActuation(event: EmploymentEventInput): ActuationOutcome {
  const disposition = EVENT_DISPOSITIONS[event.eventType];

  // Inert is decided BEFORE the resolution checks. An event that will never
  // produce work should not generate operator work demanding a classification
  // nobody needs — that would train operators to ignore the queue.
  if (disposition.kind === "inert") {
    return { kind: "inert", reason: disposition.reason };
  }

  if (!event.classification) {
    return {
      kind: "operator-work",
      reason: "classification-unresolved",
      message:
        "This worker has no recorded classification, so no room was opened. Record a worker classification determination, then re-run the event.",
    };
  }

  if (!event.jurisdiction) {
    return {
      kind: "operator-work",
      reason: "jurisdiction-unresolved",
      message:
        "This worker's employment jurisdiction could not be resolved, so no room was opened. Set the jurisdiction on their work location, then re-run the event.",
    };
  }

  const idempotencyKey = actuationIdempotencyKey(event.employmentEventId, disposition.definitionKey);

  return disposition.kind === "spawn"
    ? { kind: "spawn", definitionKey: disposition.definitionKey, idempotencyKey }
    : {
        kind: "update",
        definitionKey: disposition.definitionKey,
        idempotencyKey,
        reason: disposition.reason,
      };
}
