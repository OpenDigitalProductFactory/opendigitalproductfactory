/**
 * Placement readiness (BI-7111AF0C, design "Readiness evaluator").
 *
 * A pure projection over canonical facts. It never mutates custody or
 * adoption state, fails closed on missing or contradictory evidence, and names
 * every unmet requirement with a stable code plus the record ids it relied on.
 */

import type { AnimalCustodyStage } from "./lifecycle";
import { readAnimalIntakeRequirementSnapshot, type AnimalIntakeRequirementKey } from "./intake-policy";

export type PlacementBlockerCode =
  | "custody_closed"
  | "custody_stage_not_eligible"
  | "hold_active"
  | "packet_missing"
  | "packet_not_complete"
  | "exception_open"
  | "requirement_missing"
  | "requirement_invalid"
  | "recovery_active"
  | "housing_missing"
  | "appointment_blocking"
  | "subject_mismatch";

export interface PlacementBlocker {
  code: PlacementBlockerCode;
  requirementKey?: AnimalIntakeRequirementKey;
  message: string;
  recordIds: string[];
}

export interface PlacementReadinessFacts {
  animalProfileId: string;
  organizationId: string;
  now: Date;
  custody: {
    id: string;
    animalProfileId: string;
    organizationId: string;
    currentStage: AnimalCustodyStage;
    legalHoldActive: boolean;
    closedAt: Date | null;
  } | null;
  packet: {
    id: string;
    organizationId: string;
    subjectRef: string;
    status: string;
    requirementSnapshot: unknown;
  } | null;
  openExceptions: Array<{ id: string; summary: string }>;
  careRecords: Array<{
    id: string;
    organizationId: string;
    subjectRef: string;
    kind: string;
    lifecycle: string;
    effectiveAt: Date;
    detail: unknown;
  }>;
  housing: Array<{ id: string; releasedAt: Date | null }>;
  appointments: Array<{ id: string; status: string; footprintEnd: Date }>;
}

const ELIGIBLE_STAGES: ReadonlySet<AnimalCustodyStage> = new Set([
  "intake",
  "quarantine",
  "health-assessment",
  "procedures",
  "behavior-assessment",
  "care",
]);

/** An appointment stops blocking only once it is settled or voided. */
const SETTLED_APPOINTMENT_STATUSES = new Set(["completed", "fulfilled", "cancelled", "no-show", "entered-in-error"]);

export interface PlacementReadiness {
  ready: boolean;
  blockers: PlacementBlocker[];
  satisfied: Array<{ requirementKey: AnimalIntakeRequirementKey; recordIds: string[] }>;
}

export function evaluatePlacementReadiness(facts: PlacementReadinessFacts): PlacementReadiness {
  const blockers: PlacementBlocker[] = [];
  const satisfied: PlacementReadiness["satisfied"] = [];
  const subjectRef = `animal-profile:${facts.animalProfileId}`;

  const custody = facts.custody;
  if (!custody || custody.closedAt) {
    blockers.push({ code: "custody_closed", message: "There is no open custody episode for this animal.", recordIds: custody ? [custody.id] : [] });
  } else {
    if (custody.animalProfileId !== facts.animalProfileId || custody.organizationId !== facts.organizationId) {
      blockers.push({ code: "subject_mismatch", message: "The custody episode belongs to a different animal or organization.", recordIds: [custody.id] });
    }
    if (!ELIGIBLE_STAGES.has(custody.currentStage)) {
      blockers.push({ code: "custody_stage_not_eligible", message: `Stage ${custody.currentStage} cannot move to placement-ready.`, recordIds: [custody.id] });
    }
    if (custody.legalHoldActive) {
      blockers.push({ code: "hold_active", message: "A legal or policy hold is active and needs a human release.", recordIds: [custody.id] });
    }
  }

  const packet = facts.packet;
  if (!packet) {
    blockers.push({ code: "packet_missing", message: "No intake checklist exists for this animal.", recordIds: [] });
    return { ready: false, blockers, satisfied };
  }
  if (packet.subjectRef !== subjectRef || packet.organizationId !== facts.organizationId) {
    blockers.push({ code: "subject_mismatch", message: "The intake checklist belongs to a different animal or organization.", recordIds: [packet.id] });
  }
  if (packet.status === "stopped" || packet.status === "entered-in-error") {
    blockers.push({ code: "packet_not_complete", message: `The intake checklist is ${packet.status}.`, recordIds: [packet.id] });
  }
  if (facts.openExceptions.length > 0) {
    blockers.push({ code: "exception_open", message: `${facts.openExceptions.length} intake exception(s) are unresolved.`, recordIds: facts.openExceptions.map((entry) => entry.id) });
  }

  let snapshot;
  try {
    snapshot = readAnimalIntakeRequirementSnapshot(packet.requirementSnapshot);
  } catch {
    blockers.push({ code: "requirement_invalid", message: "The intake checklist snapshot is unreadable.", recordIds: [packet.id] });
    return { ready: false, blockers, satisfied };
  }

  const ownRecords = facts.careRecords.filter(
    (record) => record.organizationId === facts.organizationId && record.subjectRef === subjectRef && record.lifecycle === "active",
  );
  const foreign = facts.careRecords.filter((record) => record.subjectRef !== subjectRef || record.organizationId !== facts.organizationId);
  if (foreign.length > 0) {
    blockers.push({ code: "subject_mismatch", message: "Evidence from another animal was supplied.", recordIds: foreign.map((record) => record.id) });
  }

  for (const requirement of snapshot.requirements) {
    if (!requirement.required) continue;
    if (requirement.key === "housing") {
      const active = facts.housing.filter((allocation) => !allocation.releasedAt);
      if (active.length === 1) satisfied.push({ requirementKey: "housing", recordIds: [active[0]!.id] });
      else blockers.push({ code: "housing_missing", requirementKey: "housing", message: active.length === 0 ? "The animal has no active housing placement." : "The animal has more than one active placement.", recordIds: active.map((allocation) => allocation.id) });
      continue;
    }
    const evidence = ownRecords.filter((record) => {
      const detail = record.detail as { requirementKey?: unknown } | null;
      return detail?.requirementKey === requirement.key && requirement.evidenceKinds.includes(record.kind as never);
    });
    if (evidence.length === 0) {
      blockers.push({ code: "requirement_missing", requirementKey: requirement.key, message: `${requirement.label} has no evidence.`, recordIds: [] });
      continue;
    }
    if (requirement.recoveryGoverned) {
      const latest = [...evidence].sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0]!;
      const detail = latest.detail as { outcome?: unknown; recoveryUntil?: unknown } | null;
      if (detail?.outcome === "complication") {
        blockers.push({ code: "requirement_invalid", requirementKey: requirement.key, message: `${requirement.label} recorded a complication that has not been resolved by a later record.`, recordIds: [latest.id] });
        continue;
      }
      const recoveryUntil = typeof detail?.recoveryUntil === "string" ? new Date(detail.recoveryUntil) : null;
      if (recoveryUntil && recoveryUntil.getTime() > facts.now.getTime()) {
        blockers.push({ code: "recovery_active", requirementKey: requirement.key, message: `${requirement.label} recovery runs until ${recoveryUntil.toISOString()}.`, recordIds: [latest.id] });
        continue;
      }
    }
    satisfied.push({ requirementKey: requirement.key, recordIds: evidence.map((record) => record.id) });
  }

  const blocking = facts.appointments.filter(
    (appointment) => !SETTLED_APPOINTMENT_STATUSES.has(appointment.status) || appointment.footprintEnd.getTime() > facts.now.getTime(),
  );
  if (blocking.length > 0) {
    blockers.push({ code: "appointment_blocking", message: `${blocking.length} scheduled procedure(s) or recovery footprint(s) are still open.`, recordIds: blocking.map((appointment) => appointment.id) });
  }

  return { ready: blockers.length === 0, blockers, satisfied };
}
