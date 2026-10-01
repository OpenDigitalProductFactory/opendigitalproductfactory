/**
 * Controlled-substance ledger rules (EP-CSC-CUSTODY, BI-CSC-002).
 *
 * Pure: every rule a movement must satisfy before it is written, the
 * canonical hash that chains movements per register and product, and the
 * verifier that recomputes the chain. Spec §6:
 * docs/superpowers/specs/2026-09-30-controlled-substance-custody-design.md
 *
 * Statutory anchors: 21 CFR 1304.21 (complete record, per registered location),
 * 1304.22(c) (dispenser record contents), 1317.95 (two-person destruction),
 * 1301.71-1301.76 (access limited to authorized persons).
 */

import { createHash } from "node:crypto";

import type {
  ControlledSubstanceHandlerScope,
  ControlledSubstanceMovementKind,
} from "@dpf/db/controlled-substance-enums";

import { formatQuantity, parseQuantity, type Quantity } from "./quantity";

// ─── Kind rules ─────────────────────────────────────────────────────────────

type Sign = "positive" | "negative" | "either";

interface KindRule {
  sign: Sign;
  /** The scope the acting person must hold on the register. */
  actorScope: ControlledSubstanceHandlerScope;
  requiresPatient?: boolean;
  requiresCounterparty?: boolean;
  requiresDocument?: boolean;
  requiresWitness?: boolean | "product-policy";
  requiresCount?: boolean;
  requiresDiscrepancy?: boolean;
}

export const MOVEMENT_KIND_RULES: Readonly<Record<ControlledSubstanceMovementKind, KindRule>> = {
  receipt: { sign: "positive", actorScope: "receive", requiresCounterparty: true, requiresDocument: true },
  administration: { sign: "negative", actorScope: "administer", requiresPatient: true },
  dispense: { sign: "negative", actorScope: "dispense", requiresPatient: true },
  // An unusable remainder of a dose for immediate administration (1304.21(e)
  // exception): recorded here, witnessed when the product policy says so.
  waste: { sign: "negative", actorScope: "waste", requiresWitness: "product-policy" },
  return_to_supplier: { sign: "negative", actorScope: "transfer", requiresCounterparty: true, requiresDocument: true },
  transfer_out: { sign: "negative", actorScope: "transfer", requiresCounterparty: true, requiresDocument: true },
  transfer_in: { sign: "positive", actorScope: "transfer", requiresCounterparty: true, requiresDocument: true },
  // Inventory destruction: two employees witness (1317.95(d)), Form 41 reference.
  destruction: { sign: "negative", actorScope: "destroy", requiresWitness: true, requiresDocument: true },
  loss_theft: { sign: "negative", actorScope: "reconcile", requiresDiscrepancy: true },
  count_adjustment: {
    sign: "either",
    actorScope: "reconcile",
    requiresWitness: true,
    requiresCount: true,
    requiresDiscrepancy: true,
  },
  // A reversal is the exact negation of its target; its scope is the target's.
  reversal: { sign: "either", actorScope: "reconcile" },
};

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface PrincipalFacts {
  id: string;
  kind: string;
  status: string;
}

export interface HandlerGrant {
  principalId: string;
  scope: ControlledSubstanceHandlerScope;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface MovementProposal {
  kind: ControlledSubstanceMovementKind;
  quantityDelta: Quantity;
  occurredAt: Date;
  actor: PrincipalFacts;
  witness?: PrincipalFacts | null;
  patientProfileId?: string | null;
  animalProfileId?: string | null;
  counterpartyName?: string | null;
  documentRef?: string | null;
  reason?: string | null;
  countId?: string | null;
  discrepancyId?: string | null;
  /** For a reversal: the movement being reversed. */
  reverses?: {
    id: string;
    kind: ControlledSubstanceMovementKind;
    quantityDelta: Quantity;
    alreadyReversed: boolean;
    sameRegisterAndProduct: boolean;
  } | null;
}

export interface LedgerContext {
  currentBalance: Quantity;
  productWasteWitnessRequired: boolean;
  grants: readonly HandlerGrant[];
  registerActive: boolean;
  productActive: boolean;
}

export type MovementRefusalCode =
  | "register_inactive"
  | "product_inactive"
  | "zero_quantity"
  | "wrong_sign"
  | "insufficient_balance"
  | "actor_not_human"
  | "actor_not_authorized"
  | "witness_required"
  | "witness_is_actor"
  | "witness_not_human"
  | "witness_not_authorized"
  | "patient_required"
  | "single_subject_only"
  | "counterparty_required"
  | "document_required"
  | "reason_required"
  | "count_required"
  | "discrepancy_required"
  | "reversal_target_required"
  | "reversal_target_invalid"
  | "reversal_already_reversed"
  | "reversal_not_negation";

export interface MovementRefusal {
  code: MovementRefusalCode;
  message: string;
}

export type MovementEvaluation =
  | { allowed: true; balanceBefore: Quantity; balanceAfter: Quantity; actorScope: ControlledSubstanceHandlerScope }
  | { allowed: false; refusals: MovementRefusal[] };

// ─── Rules ──────────────────────────────────────────────────────────────────

/** Only an active person can handle or witness controlled substances; an AI coworker never can. */
export function isEligibleHandler(principal: PrincipalFacts): boolean {
  return principal.kind === "human" && principal.status === "active";
}

export function holdsScope(
  grants: readonly HandlerGrant[],
  principalId: string,
  scope: ControlledSubstanceHandlerScope,
  at: Date,
): boolean {
  return grants.some(
    (grant) =>
      grant.principalId === principalId &&
      grant.scope === scope &&
      grant.effectiveFrom.getTime() <= at.getTime() &&
      (grant.effectiveTo === null || grant.effectiveTo.getTime() > at.getTime()),
  );
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decide whether a movement may be written. Returns every refusal, not just the
 * first, so a person entering it sees all that is missing at once.
 */
export function evaluateMovement(proposal: MovementProposal, context: LedgerContext): MovementEvaluation {
  const refusals: MovementRefusal[] = [];
  const refuse = (code: MovementRefusalCode, message: string) => refusals.push({ code, message });
  const rule = MOVEMENT_KIND_RULES[proposal.kind];

  if (!context.registerActive) refuse("register_inactive", "This register is not active.");
  if (!context.productActive) refuse("product_inactive", "This product is not active.");

  const delta = proposal.quantityDelta;
  if (delta === 0n) refuse("zero_quantity", "A movement must change the quantity.");

  const actorScope = rule.actorScope;

  if (proposal.kind === "reversal") {
    const target = proposal.reverses;
    if (!target) {
      refuse("reversal_target_required", "A reversal must name the movement it reverses.");
    } else {
      if (!target.sameRegisterAndProduct || target.kind === "reversal") {
        refuse("reversal_target_invalid", "Only a non-reversal movement on the same register and product can be reversed.");
      }
      if (target.alreadyReversed) refuse("reversal_already_reversed", "That movement has already been reversed.");
      if (delta !== -target.quantityDelta) {
        refuse("reversal_not_negation", "A reversal must exactly negate the movement it reverses.");
      }
    }
    if (!present(proposal.reason)) refuse("reason_required", "Say why the entry is being reversed.");
  } else if (delta !== 0n) {
    if (rule.sign === "positive" && delta < 0n) refuse("wrong_sign", `A ${proposal.kind} adds stock.`);
    if (rule.sign === "negative" && delta > 0n) refuse("wrong_sign", `A ${proposal.kind} removes stock.`);
  }

  const balanceAfter = context.currentBalance + delta;
  if (balanceAfter < 0n) {
    refuse(
      "insufficient_balance",
      `The register holds ${formatQuantity(context.currentBalance)}; this would leave it negative. Record a count and open a discrepancy instead.`,
    );
  }

  // Actor
  if (!isEligibleHandler(proposal.actor)) {
    refuse("actor_not_human", "Only an active staff member can record a controlled-substance movement.");
  } else if (!holdsScope(context.grants, proposal.actor.id, actorScope, proposal.occurredAt)) {
    refuse("actor_not_authorized", `You are not authorized to ${actorScope} on this register at that time.`);
  }

  // Witness
  const witnessRequired =
    rule.requiresWitness === true || (rule.requiresWitness === "product-policy" && context.productWasteWitnessRequired);
  const witness = proposal.witness ?? null;
  if (witnessRequired && !witness) refuse("witness_required", "A second authorized person must witness this.");
  if (witness) {
    if (witness.id === proposal.actor.id) {
      refuse("witness_is_actor", "The witness must be a different person.");
    } else if (!isEligibleHandler(witness)) {
      refuse("witness_not_human", "The witness must be an active staff member.");
    } else if (!holdsScope(context.grants, witness.id, "witness", proposal.occurredAt)) {
      refuse("witness_not_authorized", "The witness is not authorized to witness on this register at that time.");
    }
  }

  // Record contents
  if (present(proposal.patientProfileId) && present(proposal.animalProfileId)) {
    refuse("single_subject_only", "Name one patient only.");
  }
  if (rule.requiresPatient && !present(proposal.patientProfileId) && !present(proposal.animalProfileId)) {
    refuse("patient_required", `A ${proposal.kind} must name the patient.`);
  }
  if (rule.requiresCounterparty && !present(proposal.counterpartyName)) {
    refuse("counterparty_required", "Name the supplier or recipient.");
  }
  if (rule.requiresDocument && !present(proposal.documentRef)) {
    refuse("document_required", "Give the invoice, order form or destruction record reference.");
  }
  if (rule.requiresCount && !present(proposal.countId)) {
    refuse("count_required", "An adjustment must cite the count that found the variance.");
  }
  if (rule.requiresDiscrepancy && !present(proposal.discrepancyId)) {
    refuse("discrepancy_required", "This must cite the discrepancy case it resolves.");
  }
  if ((proposal.kind === "count_adjustment" || proposal.kind === "loss_theft") && !present(proposal.reason)) {
    refuse("reason_required", "Explain the adjustment.");
  }

  if (refusals.length > 0) return { allowed: false, refusals };
  return { allowed: true, balanceBefore: context.currentBalance, balanceAfter, actorScope };
}

// ─── Hash chain ─────────────────────────────────────────────────────────────

/** The fields a movement's hash covers. Every recorded fact is included. */
export interface HashableMovement {
  movementRef: string;
  organizationId: string;
  registerId: string;
  productId: string;
  sequence: number;
  kind: ControlledSubstanceMovementKind;
  quantityDelta: Quantity | string;
  balanceBefore: Quantity | string;
  balanceAfter: Quantity | string;
  lotNumber: string | null;
  lotExpiresAt: Date | null;
  occurredAt: Date;
  actorPrincipalId: string;
  witnessPrincipalId: string | null;
  patientProfileId: string | null;
  animalProfileId: string | null;
  counterpartyName: string | null;
  counterpartyRegistration: string | null;
  documentRef: string | null;
  reason: string | null;
  reversesMovementId: string | null;
  countId: string | null;
  discrepancyId: string | null;
  previousHash: string | null;
}

function canonicalQuantity(value: Quantity | string): string {
  return formatQuantity(typeof value === "bigint" ? value : parseQuantity(value));
}

/** SHA-256 over a fixed-order canonical JSON array; previousHash links the chain. */
export function hashMovement(movement: HashableMovement): string {
  const canonical = JSON.stringify([
    "csm.v1",
    movement.movementRef,
    movement.organizationId,
    movement.registerId,
    movement.productId,
    movement.sequence,
    movement.kind,
    canonicalQuantity(movement.quantityDelta),
    canonicalQuantity(movement.balanceBefore),
    canonicalQuantity(movement.balanceAfter),
    movement.lotNumber,
    movement.lotExpiresAt?.toISOString() ?? null,
    movement.occurredAt.toISOString(),
    movement.actorPrincipalId,
    movement.witnessPrincipalId,
    movement.patientProfileId,
    movement.animalProfileId,
    movement.counterpartyName,
    movement.counterpartyRegistration,
    movement.documentRef,
    movement.reason,
    movement.reversesMovementId,
    movement.countId,
    movement.discrepancyId,
    movement.previousHash,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type ChainBreak =
  | { at: number; movementRef: string; reason: "sequence_gap" | "previous_hash_mismatch" | "entry_hash_mismatch" | "balance_mismatch" }
  | null;

/**
 * Recompute one register-and-product chain in sequence order and report the
 * first break, or null when it verifies.
 */
export function verifyChain(movements: ReadonlyArray<HashableMovement & { entryHash: string }>): ChainBreak {
  const ordered = [...movements].sort((a, b) => a.sequence - b.sequence);
  let previousHash: string | null = null;
  let balance = 0n;
  for (const [index, movement] of ordered.entries()) {
    const at = index;
    if (movement.sequence !== index + 1) return { at, movementRef: movement.movementRef, reason: "sequence_gap" };
    if (movement.previousHash !== previousHash) {
      return { at, movementRef: movement.movementRef, reason: "previous_hash_mismatch" };
    }
    const before = parseQuantity(canonicalQuantity(movement.balanceBefore));
    const delta = parseQuantity(canonicalQuantity(movement.quantityDelta));
    const after = parseQuantity(canonicalQuantity(movement.balanceAfter));
    if (before !== balance || after !== before + delta) {
      return { at, movementRef: movement.movementRef, reason: "balance_mismatch" };
    }
    if (hashMovement(movement) !== movement.entryHash) {
      return { at, movementRef: movement.movementRef, reason: "entry_hash_mismatch" };
    }
    previousHash = movement.entryHash;
    balance = after;
  }
  return null;
}
