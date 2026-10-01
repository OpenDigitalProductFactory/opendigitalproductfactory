/**
 * Controlled-substance movement commands (EP-CSC-CUSTODY, BI-CSC-002).
 *
 * Record a movement or reverse one. Each runs in one serializable transaction
 * with the organization's RLS context, locks the register-and-product chain,
 * evaluates the ledger policy and only then appends a hashed row. Tenancy and
 * the acting person come from the authenticated context; movements are
 * append-only at the database, so nothing here updates or deletes one.
 */

import type {
  ControlledSubstanceDiscrepancyStatus,
  ControlledSubstanceMovementKind,
} from "@dpf/db/controlled-substance-enums";

import { newId } from "@/lib/shared/new-id";

import {
  CustodyCommandError,
  date,
  loadGrants,
  loadPrincipals,
  loadRegister,
  lock,
  quantity,
  refused,
  serializable,
  setOrganizationContext,
  text,
  type CustodyClient,
  type CustodyContext,
  type CustodyTransaction,
} from "./custody-core";
import { evaluateMovement, hashMovement, type MovementProposal } from "./ledger-policy";
import { formatQuantity, parseQuantity, type Quantity } from "./quantity";

type LastMovement = { id: string; sequence: number; balanceAfter: { toString(): string }; entryHash: string };

async function lastMovement(tx: CustodyTransaction, registerDbId: string, productDbId: string) {
  return (await tx.controlledSubstanceMovement.findFirst({
    where: { registerId: registerDbId, productId: productDbId },
    orderBy: { sequence: "desc" },
    select: { id: true, sequence: true, balanceAfter: true, entryHash: true },
  })) as LastMovement | null;
}

// ─── Movements ──────────────────────────────────────────────────────────────

/** Statuses at which a discrepancy may be settled by a ledger movement. */
const SETTLING_STATUS: Partial<Record<ControlledSubstanceMovementKind, readonly ControlledSubstanceDiscrepancyStatus[]>> = {
  count_adjustment: ["adjustment_approved"],
  loss_theft: ["escalated", "adjustment_approved"],
};

/**
 * Resolve the count and discrepancy a movement cites to their row ids, and
 * refuse a citation from another register or product, or a case that has not
 * reached a settling status. Detection never adjusts the ledger on its own.
 */
async function resolveCitations(
  tx: CustodyTransaction,
  input: {
    organizationId: string;
    registerDbId: string;
    productDbId: string;
    kind: ControlledSubstanceMovementKind;
    countRef: string | null;
    discrepancyRef: string | null;
  },
): Promise<{ countDbId: string | null; discrepancyDbId: string | null }> {
  let countDbId: string | null = null;
  let discrepancyDbId: string | null = null;
  if (input.countRef) {
    const count = await tx.controlledSubstanceCount.findFirst({
      where: { organizationId: input.organizationId, countRef: input.countRef },
      select: { id: true, registerId: true },
    });
    if (!count || count.registerId !== input.registerDbId) {
      throw refused([{ code: "count_required", message: "The cited count is not on this register." }]);
    }
    countDbId = String(count.id);
  }
  if (input.discrepancyRef) {
    const discrepancy = await tx.controlledSubstanceDiscrepancy.findFirst({
      where: { organizationId: input.organizationId, discrepancyRef: input.discrepancyRef },
      select: { id: true, registerId: true, productId: true, status: true },
    });
    if (!discrepancy || discrepancy.registerId !== input.registerDbId || discrepancy.productId !== input.productDbId) {
      throw refused([{ code: "discrepancy_required", message: "The cited discrepancy is not for this register and product." }]);
    }
    const settling = SETTLING_STATUS[input.kind];
    if (settling && !settling.includes(discrepancy.status as ControlledSubstanceDiscrepancyStatus)) {
      throw refused([
        {
          code: "discrepancy_required",
          message: `The discrepancy must be ${settling.join(" or ")} before the ledger is adjusted.`,
        },
      ]);
    }
    discrepancyDbId = String(discrepancy.id);
  }
  return { countDbId, discrepancyDbId };
}

export type MovementCommand = {
  registerRef: string;
  productRef: string;
  kind: Exclude<ControlledSubstanceMovementKind, "reversal">;
  /** Positive magnitude in the product's base unit. */
  quantity: string;
  /** Only for count_adjustment: which way the count moved the balance. */
  direction?: "increase" | "decrease";
  occurredAt?: string;
  witnessPrincipalId?: string | null;
  patientProfileId?: string | null;
  animalProfileId?: string | null;
  lotNumber?: string | null;
  lotExpiresAt?: string | null;
  counterpartyName?: string | null;
  counterpartyRegistration?: string | null;
  documentRef?: string | null;
  reason?: string | null;
  /** The count (CSC-) and discrepancy (CSD-) an adjustment or loss cites. */
  countRef?: string | null;
  discrepancyRef?: string | null;
};

export type RecordedMovement = {
  movementRef: string;
  sequence: number;
  balanceBefore: string;
  balanceAfter: string;
  entryHash: string;
};

const POSITIVE_KINDS: ReadonlySet<ControlledSubstanceMovementKind> = new Set(["receipt", "transfer_in"]);

function signedDelta(command: MovementCommand): Quantity {
  const magnitude = quantity(command.quantity, "Quantity");
  if (magnitude <= 0n) throw new CustodyCommandError("invalid_input", "Quantity must be greater than zero.");
  if (command.kind === "count_adjustment") {
    if (command.direction !== "increase" && command.direction !== "decrease") {
      throw new CustodyCommandError("invalid_input", "Say whether the adjustment increases or decreases the balance.");
    }
    return command.direction === "increase" ? magnitude : -magnitude;
  }
  return POSITIVE_KINDS.has(command.kind) ? magnitude : -magnitude;
}

async function writeMovement(
  tx: CustodyTransaction,
  input: {
    organizationId: string;
    registerDbId: string;
    productDbId: string;
    proposal: MovementProposal;
    previous: LastMovement | null;
    balanceBefore: Quantity;
    balanceAfter: Quantity;
    extra: {
      lotNumber: string | null;
      lotExpiresAt: Date | null;
      counterpartyRegistration: string | null;
      reversesMovementId: string | null;
    };
  },
): Promise<RecordedMovement> {
  const { proposal, extra } = input;
  const sequence = (input.previous?.sequence ?? 0) + 1;
  const movement = {
    movementRef: `CSM-${newId(16)}`,
    organizationId: input.organizationId,
    registerId: input.registerDbId,
    productId: input.productDbId,
    sequence,
    kind: proposal.kind,
    quantityDelta: formatQuantity(proposal.quantityDelta),
    balanceBefore: formatQuantity(input.balanceBefore),
    balanceAfter: formatQuantity(input.balanceAfter),
    lotNumber: extra.lotNumber,
    lotExpiresAt: extra.lotExpiresAt,
    occurredAt: proposal.occurredAt,
    actorPrincipalId: proposal.actor.id,
    witnessPrincipalId: proposal.witness?.id ?? null,
    patientProfileId: text(proposal.patientProfileId),
    animalProfileId: text(proposal.animalProfileId),
    counterpartyName: text(proposal.counterpartyName),
    counterpartyRegistration: extra.counterpartyRegistration,
    documentRef: text(proposal.documentRef),
    reason: text(proposal.reason),
    reversesMovementId: extra.reversesMovementId,
    countId: text(proposal.countId),
    discrepancyId: text(proposal.discrepancyId),
    previousHash: input.previous?.entryHash ?? null,
  };
  const entryHash = hashMovement(movement);
  await tx.controlledSubstanceMovement.create({ data: { ...movement, entryHash } });
  return {
    movementRef: movement.movementRef,
    sequence,
    balanceBefore: movement.balanceBefore,
    balanceAfter: movement.balanceAfter,
    entryHash,
  };
}

export async function recordControlledMovement(input: {
  db: CustodyClient;
  context: CustodyContext;
  command: MovementCommand;
}): Promise<RecordedMovement> {
  const { context, command } = input;
  const now = context.now ?? new Date();
  const delta = signedDelta(command);
  const occurredAt = date(command.occurredAt, "Occurred at", now);
  if (occurredAt.getTime() > now.getTime()) {
    throw new CustodyCommandError("invalid_input", "A movement cannot be recorded in the future.");
  }
  const lotExpiresAt = command.lotExpiresAt ? date(command.lotExpiresAt, "Lot expiry", now) : null;

  return serializable(input.db, async (tx) => {
    await setOrganizationContext(tx, context.organizationId);
    const register = await loadRegister(tx, context.organizationId, command.registerRef);
    const product = (await tx.controlledSubstanceProduct.findFirst({
      where: { organizationId: context.organizationId, productRef: command.productRef },
      select: { id: true, lifecycle: true, wasteWitnessRequired: true },
    })) as { id: string; lifecycle: string; wasteWitnessRequired: boolean } | null;
    if (!product) throw new CustodyCommandError("product_not_found", "That controlled-substance product was not found.");

    await lock(tx, `controlled-substance:${register.id}:${product.id}`);

    const principals = await loadPrincipals(tx, [context.actorPrincipalId, command.witnessPrincipalId]);
    const actor = principals.get(context.actorPrincipalId)!;
    const witness = command.witnessPrincipalId ? principals.get(command.witnessPrincipalId)! : null;
    const grants = await loadGrants(tx, register.id, [...principals.keys()]);
    const previous = await lastMovement(tx, register.id, product.id);
    const currentBalance = previous ? parseQuantity(previous.balanceAfter) : 0n;
    const citations = await resolveCitations(tx, {
      organizationId: context.organizationId,
      registerDbId: register.id,
      productDbId: product.id,
      kind: command.kind,
      countRef: text(command.countRef),
      discrepancyRef: text(command.discrepancyRef),
    });

    const proposal: MovementProposal = {
      kind: command.kind,
      quantityDelta: delta,
      occurredAt,
      actor,
      witness,
      patientProfileId: command.patientProfileId,
      animalProfileId: command.animalProfileId,
      counterpartyName: command.counterpartyName,
      documentRef: command.documentRef,
      reason: command.reason,
      countId: citations.countDbId,
      discrepancyId: citations.discrepancyDbId,
    };
    const evaluation = evaluateMovement(proposal, {
      currentBalance,
      productWasteWitnessRequired: product.wasteWitnessRequired,
      grants,
      registerActive: register.lifecycle === "active",
      productActive: product.lifecycle === "active",
    });
    if (!evaluation.allowed) throw refused(evaluation.refusals);

    return writeMovement(tx, {
      organizationId: context.organizationId,
      registerDbId: register.id,
      productDbId: product.id,
      proposal,
      previous,
      balanceBefore: evaluation.balanceBefore,
      balanceAfter: evaluation.balanceAfter,
      extra: {
        lotNumber: text(command.lotNumber),
        lotExpiresAt,
        counterpartyRegistration: text(command.counterpartyRegistration),
        reversesMovementId: null,
      },
    });
  });
}

/** Reverse a wrong entry. The original is never edited; restate the correct one separately. */
export async function reverseControlledMovement(input: {
  db: CustodyClient;
  context: CustodyContext;
  command: { movementRef: string; reason: string; witnessPrincipalId?: string | null };
}): Promise<RecordedMovement> {
  const { context, command } = input;
  const now = context.now ?? new Date();

  return serializable(input.db, async (tx) => {
    await setOrganizationContext(tx, context.organizationId);
    const target = (await tx.controlledSubstanceMovement.findFirst({
      where: { organizationId: context.organizationId, movementRef: command.movementRef },
      select: {
        id: true,
        kind: true,
        quantityDelta: true,
        registerId: true,
        productId: true,
        register: { select: { lifecycle: true } },
        product: { select: { lifecycle: true, wasteWitnessRequired: true } },
        reversedBy: { select: { id: true } },
      },
    })) as {
      id: string;
      kind: ControlledSubstanceMovementKind;
      quantityDelta: { toString(): string };
      registerId: string;
      productId: string;
      register: { lifecycle: string };
      product: { lifecycle: string; wasteWitnessRequired: boolean };
      reversedBy: { id: string } | null;
    } | null;
    if (!target) throw new CustodyCommandError("movement_not_found", "That movement was not found.");

    await lock(tx, `controlled-substance:${target.registerId}:${target.productId}`);

    const principals = await loadPrincipals(tx, [context.actorPrincipalId, command.witnessPrincipalId]);
    const actor = principals.get(context.actorPrincipalId)!;
    const witness = command.witnessPrincipalId ? principals.get(command.witnessPrincipalId)! : null;
    const grants = await loadGrants(tx, target.registerId, [...principals.keys()]);
    const previous = await lastMovement(tx, target.registerId, target.productId);
    const currentBalance = previous ? parseQuantity(previous.balanceAfter) : 0n;
    const targetDelta = parseQuantity(target.quantityDelta);

    const proposal: MovementProposal = {
      kind: "reversal",
      quantityDelta: -targetDelta,
      occurredAt: now,
      actor,
      witness,
      reason: command.reason,
      reverses: {
        id: target.id,
        kind: target.kind,
        quantityDelta: targetDelta,
        alreadyReversed: target.reversedBy !== null,
        sameRegisterAndProduct: true,
      },
    };
    const evaluation = evaluateMovement(proposal, {
      currentBalance,
      productWasteWitnessRequired: target.product.wasteWitnessRequired,
      grants,
      registerActive: target.register.lifecycle === "active",
      productActive: target.product.lifecycle === "active",
    });
    if (!evaluation.allowed) throw refused(evaluation.refusals);

    return writeMovement(tx, {
      organizationId: context.organizationId,
      registerDbId: target.registerId,
      productDbId: target.productId,
      proposal,
      previous,
      balanceBefore: evaluation.balanceBefore,
      balanceAfter: evaluation.balanceAfter,
      extra: { lotNumber: null, lotExpiresAt: null, counterpartyRegistration: null, reversesMovementId: target.id },
    });
  });
}

