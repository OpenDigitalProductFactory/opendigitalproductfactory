import type { WorkerClassification } from "@dpf/db";
import { isProfessionJurisdiction, type ProfessionJurisdiction } from "@dpf/db/wiki-taxonomy";

import {
  planActuation,
  type ActuationOutcome,
  type EmploymentWorkroomKey,
} from "./employment-event-actuator";
import { createWorkCapsule } from "../work-capsules/work-capsule-store";
import { recordWorkCapsuleActivity } from "../work-capsules/work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "../work-capsules/work-capsule-store-types";

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

/**
 * Bind the actuator to a live Prisma transaction.
 *
 * Passing the SAME `tx` the EmploymentEvent row is written in is the point: the
 * event and the room it opens commit together or not at all. An event that
 * commits without its room is precisely the silent failure-to-act this epic
 * exists to remove — the organisation believes onboarding happened, and the
 * missing half is found by the worker on their first day, or by an auditor.
 *
 * `createWorkCapsule` runs its own `inTransaction`, which is a no-op when handed
 * a transaction client, so nesting is safe.
 */
export function prismaActuatorWriter(
  tx: CapsuleDb,
  actor: WorkCapsuleActor,
): ActuatorCapsuleWriter {
  return {
    async createWorkCapsule(args) {
      const created = await createWorkCapsule({
        db: tx,
        actor,
        input: {
          source: args.input.source as never,
          title: args.input.title,
          objective: args.input.objective,
          idempotencyKey: args.input.idempotencyKey,
          scope: args.input.scope,
          workspaceState: args.input.workspaceState,
        },
      });
      return { id: created.id, capsuleId: created.capsuleId };
    },
    async findByIdempotencyKey(key) {
      const row = await tx.workroom.findUnique({ where: { idempotencyKey: key } });
      return row ? { id: row.id, capsuleId: row.capsuleId } : null;
    },
    async recordUpdate({ capsuleId, eventType, reason }) {
      const room = await tx.workroom.findFirst({ where: { capsuleId } });
      if (!room) return;
      await recordWorkCapsuleActivity(tx, {
        workCapsuleId: room.id,
        kind: "status-changed",
        summary: `Employment event ${eventType}: ${reason}`,
        actor,
      });
    },
  };
}

/**
 * One call for the lifecycle-event action: bind the writer to the live
 * transaction and actuate.
 *
 * Exists so the action module states its intent in one line — the seam is easy
 * to see and hard to drop — rather than assembling a writer inline.
 */
export async function actuateForLifecycleEvent(
  tx: CapsuleDb,
  args: {
    employmentEventId: string;
    eventType: EmploymentEventType;
    worker: ActuatorWorkerRow;
    employsIn: readonly string[];
    userId: string;
  },
): Promise<ActuationResult> {
  return actuateEmploymentEvent({
    employmentEventId: args.employmentEventId,
    eventType: args.eventType,
    worker: args.worker,
    employsIn: args.employsIn,
    writer: prismaActuatorWriter(tx, {
      userId: args.userId,
      agentId: null,
      principalId: null,
    }),
  });
}

/**
 * What the event did, in words an operator can act on.
 *
 * An actuator that silently succeeds is only marginally better than the log it
 * replaced: the operator still cannot tell whether anything opened. Operator
 * work in particular must never be swallowed — an unresolved worker produces no
 * room, and the person recording the event is the one who can fix it.
 */
export function describeActuation(
  actuation: ActuationResult | null,
  workerName: string,
): string {
  const recorded = `Lifecycle event recorded for ${workerName}.`;
  if (!actuation) return recorded;

  switch (actuation.kind) {
    case "spawned":
      return `${recorded} Opened ${actuation.capsuleId} to carry the work.`;
    case "already-present":
      return `${recorded} ${actuation.capsuleId} was already open for it.`;
    case "updated":
      return `${recorded} Updated the open room ${actuation.capsuleId}.`;
    case "update-target-missing":
      return `${recorded} No open ${actuation.definitionKey} room was found to update, so nothing was changed.`;
    case "operator-work":
      return `${recorded} No room was opened: ${actuation.message}`;
    case "inert":
      return recorded;
  }
}
