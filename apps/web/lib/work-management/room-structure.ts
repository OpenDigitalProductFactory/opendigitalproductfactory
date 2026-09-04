/**
 * Work Room structure — the value stream + lifecycle of the room's SUBJECT
 * (EP-WORKROOM-COMMS / EP-VSL-SURFACE fold).
 *
 * A Work Room is collaborative, but the collaboration happens WITHIN a structure:
 * the subject the room is formed around sits in an OVSM value-stream stage and
 * follows a lifecycle grammar (Stage → in-stage State → next advancement gates).
 * This pure resolver folds the existing OVSM + lifecycle-grammar substrate onto a
 * room's subject — reused, not rebuilt. The loader resolves the subject's stored
 * status/stage and passes a descriptor here; this stays DB-free.
 *
 * Design of record: docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md §2;
 * VSL substrate: apps/web/lib/lifecycle-grammars.ts + apps/web/lib/crm/account-value-stream.ts.
 */
import {
  accountStatusToOvsmStage,
  opportunityStageToOvsmStage,
  ovsmStageLabel,
} from "@/lib/crm/account-value-stream";
import { canAdvance, getStage, type LifecycleGrammar, type LifecyclePoint } from "@/lib/lifecycle-grammar";
import {
  BOOKKEEPING_ROOM_GRAMMAR,
  CUSTOMER_ACCOUNT_GRAMMAR,
  OPPORTUNITY_GRAMMAR,
  resolveBookkeepingRoomPoint,
  resolveCustomerAccountPoint,
  resolveOpportunityPoint,
} from "@/lib/lifecycle-grammars";
import type { OperationalValueStreamStageKey } from "@dpf/storefront-templates";

/** The room subject descriptor the loader builds from the subject's stored row. */
export type WorkroomStructureSubject =
  | { kind: "opportunity"; stage: string }
  | { kind: "customer-account"; status: string }
  | { kind: "bookkeeping-period"; status: string };

export interface WorkroomValueStream {
  stage: OperationalValueStreamStageKey;
  label: string;
}

export interface WorkroomLifecycleGate {
  toStage: string;
  toStageLabel: string;
  allowed: boolean;
  reason?: string;
}

export interface WorkroomLifecycle {
  grammarKey: string;
  stage: string;
  stageLabel: string;
  state: string;
  stateLabel: string;
  band: string;
  /** The advancement gates from the current stage — what it would take to move on. */
  nextGates: WorkroomLifecycleGate[];
}

export interface WorkroomStructure {
  valueStream: WorkroomValueStream | null;
  lifecycle: WorkroomLifecycle | null;
}

function buildLifecycle(grammar: LifecycleGrammar, point: LifecyclePoint): WorkroomLifecycle {
  const stageDef = getStage(grammar, point.stage);
  const stateDef = stageDef?.states.find((candidate) => candidate.key === point.state) ?? null;
  const nextGates: WorkroomLifecycleGate[] = (stageDef?.advancesTo ?? []).map((toStage) => {
    const check = canAdvance(grammar, point, toStage);
    return {
      toStage,
      toStageLabel: getStage(grammar, toStage)?.label ?? toStage,
      allowed: check.allowed,
      ...(check.reason ? { reason: check.reason } : {}),
    };
  });
  return {
    grammarKey: grammar.key,
    stage: point.stage,
    stageLabel: stageDef?.label ?? point.stage,
    state: point.state,
    stateLabel: stateDef?.label ?? point.state,
    band: stateDef?.band ?? "on-track",
    nextGates,
  };
}

/**
 * Resolve the value-stream + lifecycle structure for a room's subject. Returns null
 * when the subject has no value-stream/lifecycle binding (e.g. a platform-development
 * subject that is not on the customer OVSM — a paved follow-up).
 */
export function resolveWorkroomStructure(subject: WorkroomStructureSubject | null): WorkroomStructure | null {
  if (!subject) return null;

  switch (subject.kind) {
    case "opportunity": {
      const ovsm = opportunityStageToOvsmStage(subject.stage);
      return {
        valueStream: { stage: ovsm, label: ovsmStageLabel(ovsm) },
        lifecycle: buildLifecycle(OPPORTUNITY_GRAMMAR, resolveOpportunityPoint(subject.stage)),
      };
    }
    case "customer-account": {
      const ovsm = accountStatusToOvsmStage(subject.status);
      return {
        valueStream: { stage: ovsm, label: ovsmStageLabel(ovsm) },
        lifecycle: buildLifecycle(CUSTOMER_ACCOUNT_GRAMMAR, resolveCustomerAccountPoint(subject.status)),
      };
    }
    case "bookkeeping-period": {
      // The books loop is an internal operate-the-business lifecycle, not a customer OVSM stage —
      // so it carries a lifecycle but no customer value stream (like platform-development subjects).
      return {
        valueStream: null,
        lifecycle: buildLifecycle(BOOKKEEPING_ROOM_GRAMMAR, resolveBookkeepingRoomPoint(subject.status)),
      };
    }
    default:
      return null;
  }
}

/**
 * Map a room source to its subject descriptor from the source's stored fields.
 * Returns null for sources without a value-stream/lifecycle subject (platform
 * development, workflow) — those fold onto the platform's own delivery stream in a
 * follow-up. `opportunityStage` / `accountStatus` are supplied by the loader.
 */
export function workroomStructureSubjectFor(input: {
  sourceType: string;
  opportunityStage?: string | null;
  accountStatus?: string | null;
  bookkeepingPeriodStatus?: string | null;
}): WorkroomStructureSubject | null {
  if (input.sourceType === "opportunity" && input.opportunityStage) {
    return { kind: "opportunity", stage: input.opportunityStage };
  }
  if (
    (input.sourceType === "engagement" ||
      input.sourceType === "activity" ||
      input.sourceType === "booking" ||
      input.sourceType === "storefront-booking") &&
    input.accountStatus
  ) {
    return { kind: "customer-account", status: input.accountStatus };
  }
  if (input.sourceType === "bookkeeping-period" && input.bookkeepingPeriodStatus) {
    return { kind: "bookkeeping-period", status: input.bookkeepingPeriodStatus };
  }
  return null;
}
