import type { WorkerClassification } from "@dpf/db";
import { isProfessionJurisdiction, type ProfessionJurisdiction } from "@dpf/db/wiki-taxonomy";

import {
  planActuation,
  type ActuationOutcome,
  type EmploymentWorkroomKey,
} from "./employment-event-actuator";
import { resolveEmploymentJurisdiction } from "./employment-jurisdiction";
import { resolveClassification } from "./worker-classification";
import type { EmploymentEventType } from "./workforce-types";

/**
 * The runtime half of the employment event actuator (BI-2624B7EA): resolve the
 * worker's classification and jurisdiction, decide, and open the room.
 *
 * The decision itself lives in `planActuation` and is pure. This module only
 * gathers inputs and performs the write, so the interesting logic stays
 * exhaustively testable without a database.
 */

/** The worker shape this needs. Structural, so a test supplies it without Prisma. */
export type ActuatorWorkerRow = {
  readonly id: string;
  readonly displayName: string;
  readonly employmentType: { readonly classification: WorkerClassification | null } | null;
  readonly workLocation: { readonly id: string; readonly jurisdictionSlug: string | null } | null;
};

export type ActuatorTitles = {
  readonly title: string;
  readonly objective: string;
};

const TITLES: Readonly<Record<EmploymentWorkroomKey, (name: string) => ActuatorTitles>> = {
  "worker-onboarding": (name) => ({
    title: `Onboard ${name}`,
    objective: `Bring ${name} to a working first day: the steps their occupation's onboarding curriculum prescribes, and the access their classification lawfully allows.`,
  }),
  "worker-change": (name) => ({
    title: `Change of role for ${name}`,
    objective: `Carry ${name} across the change: the mover curriculum for their new occupation, and any access that must follow or stop following them.`,
  }),
  "worker-offboarding": (name) => ({
    title: `Offboard ${name}`,
    objective: `Close ${name}'s engagement cleanly. This room stays open until every dated revocation has actually executed — access outliving an offboarding is the failure this exists to prevent.`,
  }),
};

/**
 * Resolve the two facts the actuator refuses to guess.
 *
 * Both resolvers already fail loudly on their own terms; this only adapts their
 * shapes. Neither is defaulted here — a permissive default would be a legal
 * claim invented by an adapter.
 */
export function resolveActuationInputs(
  worker: ActuatorWorkerRow,
  employsIn: readonly string[],
): {
  readonly classification: WorkerClassification | null;
  readonly jurisdiction: ProfessionJurisdiction | null;
} {
  const classification = resolveClassification(worker);
  const jurisdiction = resolveEmploymentJurisdiction(worker, employsIn);

  return {
    classification: classification.resolved ? classification.classification : null,
    jurisdiction: jurisdiction.resolved ? jurisdiction.jurisdiction : null,
  };
}

/** Minimal surface of the capsule store this needs, so tests need no database. */
export type ActuatorCapsuleWriter = {
  createWorkCapsule(args: {
    input: {
      source: string;
      title: string;
      objective: string;
      idempotencyKey: string;
      scope: { decisionScope: "wwwd"; portfolioRole: "forEmployees" };
      workspaceState: Record<string, unknown>;
    };
  }): Promise<{ id: string; capsuleId: string }>;
  findByIdempotencyKey(key: string): Promise<{ id: string; capsuleId: string } | null>;
  recordUpdate(args: {
    capsuleId: string;
    eventType: EmploymentEventType;
    reason: string;
  }): Promise<void>;
};

export type ActuationResult =
  | { readonly kind: "spawned"; readonly capsuleId: string; readonly definitionKey: EmploymentWorkroomKey }
  | { readonly kind: "already-present"; readonly capsuleId: string }
  | { readonly kind: "updated"; readonly capsuleId: string }
  /** The open room the update targeted does not exist. Recorded, not invented. */
  | { readonly kind: "update-target-missing"; readonly definitionKey: EmploymentWorkroomKey }
  | { readonly kind: "inert"; readonly reason: string }
  | { readonly kind: "operator-work"; readonly message: string };

/**
 * Actuate one employment event.
 *
 * Idempotency is the database's job: `Workroom.idempotencyKey` is unique, so
 * replay and two racing writers converge on one room. The pre-check here is an
 * optimisation, not the guarantee — a race that slips past it still collapses on
 * the constraint, and `createWorkCapsule` already returns the existing row.
 */
export async function actuateEmploymentEvent(args: {
  readonly employmentEventId: string;
  readonly eventType: EmploymentEventType;
  readonly worker: ActuatorWorkerRow;
  readonly employsIn: readonly string[];
  readonly writer: ActuatorCapsuleWriter;
}): Promise<ActuationResult> {
  const { classification, jurisdiction } = resolveActuationInputs(args.worker, args.employsIn);

  const outcome: ActuationOutcome = planActuation({
    employmentEventId: args.employmentEventId,
    eventType: args.eventType,
    employeeProfileId: args.worker.id,
    classification,
    jurisdiction,
  });

  if (outcome.kind === "inert") return { kind: "inert", reason: outcome.reason };
  if (outcome.kind === "operator-work") {
    return { kind: "operator-work", message: outcome.message };
  }

  if (outcome.kind === "update") {
    const open = await args.writer.findByIdempotencyKey(outcome.idempotencyKey);
    if (!open) return { kind: "update-target-missing", definitionKey: outcome.definitionKey };
    await args.writer.recordUpdate({
      capsuleId: open.capsuleId,
      eventType: args.eventType,
      reason: outcome.reason,
    });
    return { kind: "updated", capsuleId: open.capsuleId };
  }

  const existing = await args.writer.findByIdempotencyKey(outcome.idempotencyKey);
  if (existing) return { kind: "already-present", capsuleId: existing.capsuleId };

  const titles = TITLES[outcome.definitionKey](args.worker.displayName);
  const created = await args.writer.createWorkCapsule({
    input: {
      source: outcome.definitionKey,
      title: titles.title,
      objective: titles.objective,
      idempotencyKey: outcome.idempotencyKey,
      // Every employment definition is wwwd and coordinates forEmployees
      // (BI-28EFA338). These coordinate a customer's decisions about their own
      // workforce, never platform development.
      scope: { decisionScope: "wwwd", portfolioRole: "forEmployees" },
      workspaceState: {
        employeeProfileId: args.worker.id,
        employmentEventId: args.employmentEventId,
        eventType: args.eventType,
        classification,
        jurisdiction,
      },
    },
  });

  return { kind: "spawned", capsuleId: created.capsuleId, definitionKey: outcome.definitionKey };
}

/** Narrowing helper for a stored slug, so a bad row cannot reach a policy lookup. */
export function asProfessionJurisdiction(value: string | null): ProfessionJurisdiction | null {
  return value && isProfessionJurisdiction(value) ? value : null;
}
