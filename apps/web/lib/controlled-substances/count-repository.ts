/**
 * Controlled-substance count command (EP-CSC-CUSTODY, BI-6322FB1A).
 *
 * Records a physical inventory (21 CFR 1304.11). Expected quantities come from
 * the ledger as of the count; each non-zero variance opens a discrepancy case.
 * Detection never adjusts the ledger.
 */

import type {
  ControlledSubstanceCountKind,
  ControlledSubstanceCountMethod,
  ControlledSubstanceCountTiming,
  ControlledSubstanceSchedule,
} from "@dpf/db/controlled-substance-enums";

import { newId } from "@/lib/shared/new-id";

import { evaluateCount } from "./count-policy";
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
} from "./custody-core";
import { formatQuantity, parseQuantity, type Quantity } from "./quantity";

// ─── Counts ─────────────────────────────────────────────────────────────────

export type CountCommand = {
  registerRef: string;
  kind: ControlledSubstanceCountKind;
  timing: ControlledSubstanceCountTiming;
  takenAt?: string;
  witnessPrincipalId?: string | null;
  witnessRequired?: boolean;
  notes?: string | null;
  lines: Array<{
    productRef: string;
    counted: string;
    method: ControlledSubstanceCountMethod;
    openedContainer?: boolean;
    containerUnits?: string | null;
  }>;
};

export type RecordedCount = {
  countRef: string;
  lines: Array<{ productRef: string; expected: string; counted: string; variance: string }>;
  discrepancyRefs: string[];
};

/**
 * Record a physical count. Expected quantities are the ledger balance as of
 * takenAt (sum of movements that occurred by then). Each non-zero variance
 * opens a discrepancy case; the ledger itself is not adjusted.
 */
export async function recordControlledCount(input: {
  db: CustodyClient;
  context: CustodyContext;
  command: CountCommand;
}): Promise<RecordedCount> {
  const { context, command } = input;
  const now = context.now ?? new Date();
  const takenAt = date(command.takenAt, "Taken at", now);
  if (takenAt.getTime() > now.getTime()) throw new CustodyCommandError("invalid_input", "A count cannot be in the future.");

  return serializable(input.db, async (tx) => {
    await setOrganizationContext(tx, context.organizationId);
    const register = await loadRegister(tx, context.organizationId, command.registerRef);
    await lock(tx, `controlled-substance-count:${register.id}`);

    const products = (await tx.controlledSubstanceProduct.findMany({
      where: { organizationId: context.organizationId, productRef: { in: command.lines.map((line) => line.productRef) } },
      select: { id: true, productRef: true, name: true, schedule: true, containerUnits: true },
    })) as Array<{
      id: string;
      productRef: string;
      name: string;
      schedule: ControlledSubstanceSchedule;
      containerUnits: { toString(): string } | null;
    }>;
    const byRef = new Map(products.map((product) => [product.productRef, product]));
    for (const line of command.lines) {
      if (!byRef.has(line.productRef)) {
        throw new CustodyCommandError("product_not_found", `Product ${line.productRef} was not found.`);
      }
    }
    for (const product of products) await lock(tx, `controlled-substance:${register.id}:${product.id}`);

    const principals = await loadPrincipals(tx, [context.actorPrincipalId, command.witnessPrincipalId]);
    const taker = principals.get(context.actorPrincipalId)!;
    const witness = command.witnessPrincipalId ? principals.get(command.witnessPrincipalId)! : null;
    const grants = await loadGrants(tx, register.id, [...principals.keys()]);

    const lineProposals = [];
    for (const line of command.lines) {
      const product = byRef.get(line.productRef)!;
      const history = await tx.controlledSubstanceMovement.findMany({
        where: { registerId: register.id, productId: product.id, occurredAt: { lte: takenAt } },
        select: { quantityDelta: true },
      });
      const expected = history.reduce<Quantity>(
        (sum, row) => sum + parseQuantity(row.quantityDelta as { toString(): string }),
        0n,
      );
      const containerUnits = line.containerUnits
        ? quantity(line.containerUnits, "Container size")
        : product.containerUnits
          ? parseQuantity(product.containerUnits)
          : null;
      lineProposals.push({
        productId: product.id,
        productName: product.name,
        schedule: product.schedule,
        method: line.method,
        openedContainer: Boolean(line.openedContainer),
        containerUnits,
        expected,
        counted: quantity(line.counted, `${product.name} count`),
      });
    }

    const evaluation = evaluateCount({
      kind: command.kind,
      takenAt,
      taker,
      witness,
      witnessRequired: Boolean(command.witnessRequired),
      grants,
      lines: lineProposals,
    });
    if (!evaluation.allowed) throw refused(evaluation.refusals);

    const countRef = `CSC-${newId(16)}`;
    const count = await tx.controlledSubstanceCount.create({
      data: {
        countRef,
        organizationId: context.organizationId,
        registerId: register.id,
        kind: command.kind,
        timing: command.timing,
        takenAt,
        takenByPrincipalId: taker.id,
        witnessPrincipalId: witness?.id ?? null,
        notes: text(command.notes),
      },
      select: { id: true },
    });

    const refByDbId = new Map(products.map((product) => [product.id, product.productRef]));
    const recordedLines: RecordedCount["lines"] = [];
    const discrepancyRefs: string[] = [];
    for (const [index, line] of evaluation.lines.entries()) {
      const proposal = lineProposals[index];
      const countLine = await tx.controlledSubstanceCountLine.create({
        data: {
          countLineRef: `CSL-${newId(16)}`,
          organizationId: context.organizationId,
          countId: count.id,
          productId: line.productId,
          expectedQuantity: formatQuantity(line.expected),
          countedQuantity: formatQuantity(line.counted),
          varianceQuantity: formatQuantity(line.variance),
          method: line.method,
          openedContainer: proposal.openedContainer,
          containerUnits: proposal.containerUnits === null ? null : formatQuantity(proposal.containerUnits),
        },
        select: { id: true },
      });
      if (line.variance !== 0n) {
        const discrepancyRef = `CSD-${newId(16)}`;
        await tx.controlledSubstanceDiscrepancy.create({
          data: {
            discrepancyRef,
            organizationId: context.organizationId,
            registerId: register.id,
            productId: line.productId,
            countLineId: countLine.id,
            varianceQuantity: formatQuantity(line.variance),
            discoveredAt: takenAt,
            openedByPrincipalId: taker.id,
          },
        });
        discrepancyRefs.push(discrepancyRef);
      }
      recordedLines.push({
        productRef: refByDbId.get(line.productId)!,
        expected: formatQuantity(line.expected),
        counted: formatQuantity(line.counted),
        variance: formatQuantity(line.variance),
      });
    }

    return { countRef, lines: recordedLines, discrepancyRefs };
  });
}

