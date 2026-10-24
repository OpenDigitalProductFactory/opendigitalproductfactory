import { describe, expect, it, vi } from "vitest";

import { recordControlledCount } from "./count-repository";
import { CustodyCommandError, type CustodyClient } from "./custody-core";
import { transitionControlledDiscrepancy } from "./discrepancy-repository";
import { recordControlledMovement, reverseControlledMovement } from "./movement-repository";
import { hashMovement, verifyChain, type HashableMovement } from "./ledger-policy";

const ORG = "org-1";
const NOW = new Date("2026-09-30T15:00:00Z");
const CONTEXT = { organizationId: ORG, actorPrincipalId: "p-julia", now: NOW };
const T0 = new Date("2026-01-01T00:00:00Z");
const SCOPES = ["receive", "administer", "dispense", "waste", "witness", "transfer", "destroy", "count", "reconcile"];

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = () => vi.fn(async (_args?: any): Promise<Row[]> => []);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = () => vi.fn(async (_args?: any): Promise<Row | null> => null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const one = () => vi.fn(async (_args?: any): Promise<Row> => ({}));

function fixture() {
  const written: Array<HashableMovement & { entryHash: string }> = [];
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
    principal: { findMany: rows() },
    controlledSubstanceRegister: { findFirst: row() },
    controlledSubstanceProduct: { findFirst: row(), findMany: rows() },
    controlledSubstanceHandlerAuthorization: { findMany: rows() },
    controlledSubstanceMovement: { findFirst: row(), findMany: rows(), create: one() },
    controlledSubstanceCount: { findFirst: row(), create: one() },
    controlledSubstanceCountLine: { create: one() },
    controlledSubstanceDiscrepancy: { findFirst: row(), create: one(), update: one() },
  };
  const db = { $transaction: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)) } as unknown as CustodyClient;

  tx.controlledSubstanceRegister.findFirst.mockResolvedValue({
    id: "reg-db",
    registerRef: "CSR-1",
    lifecycle: "active",
    careLocation: { timezone: "America/Chicago" },
  });
  tx.controlledSubstanceProduct.findFirst.mockResolvedValue({ id: "prod-db", lifecycle: "active", wasteWitnessRequired: true });
  tx.principal.findMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
    args.where.id.in.map((id) => ({ id, kind: id === "p-ai" ? "agent" : "human", status: "active" })),
  );
  tx.controlledSubstanceHandlerAuthorization.findMany.mockImplementation(async (args: { where: { principalId: { in: string[] } } }) =>
    args.where.principalId.in.flatMap((principalId) =>
      SCOPES.map((scope) => ({ principalId, scope, effectiveFrom: T0, effectiveTo: null })),
    ),
  );
  // The ledger tail is whatever was last written in this fixture.
  tx.controlledSubstanceMovement.findFirst.mockImplementation(async () => {
    const last = written.at(-1);
    return last ? { id: last.movementRef, sequence: last.sequence, balanceAfter: last.balanceAfter, entryHash: last.entryHash } : null;
  });
  tx.controlledSubstanceMovement.create.mockImplementation(async (args: { data: HashableMovement & { entryHash: string } }) => {
    written.push(args.data);
    return { ...args.data };
  });
  return { db, tx, written };
}

const RECEIPT = {
  registerRef: "CSR-1",
  productRef: "CSP-1",
  kind: "receipt" as const,
  quantity: "20",
  counterpartyName: "Midwest Veterinary Supply",
  counterpartyRegistration: "RM0000000",
  documentRef: "INV-4471",
  lotNumber: "L-22",
  occurredAt: "2026-09-30T14:00:00Z",
};

describe("recordControlledMovement", () => {
  it("sets the organization context, locks the chain, and writes a hashed, balanced movement", async () => {
    const { db, tx, written } = fixture();
    const first = await recordControlledMovement({ db, context: CONTEXT, command: RECEIPT });
    const second = await recordControlledMovement({
      db,
      context: CONTEXT,
      command: {
        registerRef: "CSR-1",
        productRef: "CSP-1",
        kind: "administration",
        quantity: "0.75",
        patientProfileId: "pat-scout",
        occurredAt: "2026-09-30T14:30:00Z",
      },
    });

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), "controlled-substance:reg-db:prod-db");
    expect(first).toMatchObject({ sequence: 1, balanceBefore: "0.0000", balanceAfter: "20.0000" });
    expect(second).toMatchObject({ sequence: 2, balanceBefore: "20.0000", balanceAfter: "19.2500" });
    expect(written[1]).toMatchObject({ quantityDelta: "-0.7500", previousHash: first.entryHash, actorPrincipalId: "p-julia" });
    expect(verifyChain(written)).toBeNull();
    expect(written[1].entryHash).toBe(hashMovement(written[1]));
  });

  it("refuses without writing when the policy refuses", async () => {
    const { db, tx } = fixture();
    const attempt = recordControlledMovement({
      db,
      context: CONTEXT,
      command: { registerRef: "CSR-1", productRef: "CSP-1", kind: "administration", quantity: "1", patientProfileId: "pat-1" },
    });
    await expect(attempt).rejects.toMatchObject({ code: "refused", refusals: [{ code: "insufficient_balance" }] });
    expect(tx.controlledSubstanceMovement.create).not.toHaveBeenCalled();
  });

  it("never lets an AI coworker record a movement", async () => {
    const { db, tx } = fixture();
    const attempt = recordControlledMovement({ db, context: { ...CONTEXT, actorPrincipalId: "p-ai" }, command: RECEIPT });
    await expect(attempt).rejects.toMatchObject({ refusals: [{ code: "actor_not_human" }] });
    expect(tx.controlledSubstanceMovement.create).not.toHaveBeenCalled();
  });

  it("rejects malformed quantities, future dates and unknown registers before opening a transaction", async () => {
    const { db } = fixture();
    await expect(recordControlledMovement({ db, context: CONTEXT, command: { ...RECEIPT, quantity: "1.23456" } })).rejects.toBeInstanceOf(
      CustodyCommandError,
    );
    await expect(
      recordControlledMovement({ db, context: CONTEXT, command: { ...RECEIPT, occurredAt: "2026-10-01T00:00:00Z" } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect((db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
  });

  it("refuses an adjustment citing a discrepancy that has not been approved", async () => {
    const { db, tx } = fixture();
    await recordControlledMovement({ db, context: CONTEXT, command: RECEIPT });
    tx.controlledSubstanceCount.findFirst.mockResolvedValue({ id: "count-db", registerId: "reg-db" });
    tx.controlledSubstanceDiscrepancy.findFirst.mockResolvedValue({
      id: "disc-db",
      registerId: "reg-db",
      productId: "prod-db",
      status: "investigating",
    });
    const adjustment = {
      registerRef: "CSR-1",
      productRef: "CSP-1",
      kind: "count_adjustment" as const,
      quantity: "0.5",
      direction: "decrease" as const,
      witnessPrincipalId: "p-theo",
      countRef: "CSC-1",
      discrepancyRef: "CSD-1",
      reason: "Overfill on prior draw",
    };
    await expect(recordControlledMovement({ db, context: CONTEXT, command: adjustment })).rejects.toMatchObject({
      refusals: [{ code: "discrepancy_required" }],
    });

    tx.controlledSubstanceDiscrepancy.findFirst.mockResolvedValue({
      id: "disc-db",
      registerId: "reg-db",
      productId: "prod-db",
      status: "adjustment_approved",
    });
    await expect(recordControlledMovement({ db, context: CONTEXT, command: adjustment })).resolves.toMatchObject({
      balanceAfter: "19.5000",
    });
  });
});

describe("reverseControlledMovement", () => {
  it("writes the exact negation and refuses a second reversal", async () => {
    const { db, tx, written } = fixture();
    await recordControlledMovement({ db, context: CONTEXT, command: RECEIPT });
    tx.controlledSubstanceMovement.findFirst.mockImplementationOnce(async () => ({
      id: "m-1",
      kind: "receipt",
      quantityDelta: "20.0000",
      registerId: "reg-db",
      productId: "prod-db",
      register: { lifecycle: "active" },
      product: { lifecycle: "active", wasteWitnessRequired: true },
      reversedBy: null,
    }));
    const reversal = await reverseControlledMovement({
      db,
      context: CONTEXT,
      command: { movementRef: written[0].movementRef, reason: "Keyed against the wrong register" },
    });
    expect(reversal).toMatchObject({ sequence: 2, balanceAfter: "0.0000" });
    expect(written[1]).toMatchObject({ kind: "reversal", quantityDelta: "-20.0000", reversesMovementId: "m-1" });

    tx.controlledSubstanceMovement.findFirst.mockImplementationOnce(async () => ({
      id: "m-1",
      kind: "receipt",
      quantityDelta: "20.0000",
      registerId: "reg-db",
      productId: "prod-db",
      register: { lifecycle: "active" },
      product: { lifecycle: "active", wasteWitnessRequired: true },
      reversedBy: { id: "m-2" },
    }));
    await expect(
      reverseControlledMovement({ db, context: CONTEXT, command: { movementRef: written[0].movementRef, reason: "again" } }),
    ).rejects.toMatchObject({ refusals: expect.arrayContaining([{ code: "reversal_already_reversed", message: expect.any(String) }]) });
  });
});

describe("recordControlledCount", () => {
  it("derives expected quantities from the ledger and opens a discrepancy for each variance", async () => {
    const { db, tx } = fixture();
    tx.controlledSubstanceProduct.findMany.mockResolvedValue([
      { id: "prod-a", productRef: "CSP-A", name: "Hydromorphone 2 mg/mL", schedule: "c_ii", containerUnits: "10" },
      { id: "prod-b", productRef: "CSP-B", name: "Butorphanol 10 mg/mL", schedule: "c_iv", containerUnits: "10" },
    ]);
    tx.controlledSubstanceMovement.findMany.mockImplementation(async (args: { where: { productId: string } }) =>
      args.where.productId === "prod-a" ? [{ quantityDelta: "10.0000" }, { quantityDelta: "-2.5000" }] : [{ quantityDelta: "5.0000" }],
    );
    tx.controlledSubstanceCount.create.mockResolvedValue({ id: "count-db" });
    tx.controlledSubstanceCountLine.create.mockImplementation(async () => ({ id: `line-${Math.random()}` }));

    const result = await recordControlledCount({
      db,
      context: CONTEXT,
      command: {
        registerRef: "CSR-1",
        kind: "biennial",
        timing: "close_of_business",
        takenAt: "2026-09-30T14:00:00Z",
        lines: [
          { productRef: "CSP-A", counted: "7.5", method: "exact", openedContainer: true },
          { productRef: "CSP-B", counted: "4.8", method: "estimated", openedContainer: true },
        ],
      },
    });

    expect(result.lines).toEqual([
      { productRef: "CSP-A", expected: "7.5000", counted: "7.5000", variance: "0.0000" },
      { productRef: "CSP-B", expected: "5.0000", counted: "4.8000", variance: "-0.2000" },
    ]);
    expect(result.discrepancyRefs).toHaveLength(1);
    expect(tx.controlledSubstanceDiscrepancy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: "prod-b", varianceQuantity: "-0.2000", openedByPrincipalId: "p-julia" }),
    });
    // Detection never adjusts the ledger.
    expect(tx.controlledSubstanceMovement.create).not.toHaveBeenCalled();
  });

  it("refuses an estimated Schedule II count and writes nothing", async () => {
    const { db, tx } = fixture();
    tx.controlledSubstanceProduct.findMany.mockResolvedValue([
      { id: "prod-a", productRef: "CSP-A", name: "Hydromorphone", schedule: "c_ii", containerUnits: null },
    ]);
    await expect(
      recordControlledCount({
        db,
        context: CONTEXT,
        command: {
          registerRef: "CSR-1",
          kind: "biennial",
          timing: "opening_of_business",
          lines: [{ productRef: "CSP-A", counted: "3", method: "estimated", openedContainer: true }],
        },
      }),
    ).rejects.toMatchObject({ refusals: [{ code: "estimate_not_permitted" }] });
    expect(tx.controlledSubstanceCount.create).not.toHaveBeenCalled();
  });
});

describe("transitionControlledDiscrepancy", () => {
  function caseRow(overrides: Row = {}): Row {
    return {
      id: "disc-db",
      registerId: "reg-db",
      status: "investigating",
      classification: "unclassified",
      classificationRationale: null,
      discoveredAt: new Date("2026-10-02T23:00:00Z"),
      regulatorNoticeDueAt: null,
      regulatorNoticeGivenAt: null,
      regulatorNoticeRef: null,
      lossReportDueAt: null,
      lossReportFiledAt: null,
      lossReportRef: null,
      resolution: null,
      register: { careLocation: { timezone: "America/Chicago" } },
      ...overrides,
    };
  }

  it("stamps the DEA notice and Form 106 deadlines when a case is escalated as suspected theft", async () => {
    const { db, tx } = fixture();
    tx.controlledSubstanceDiscrepancy.findFirst.mockResolvedValue(caseRow());
    const result = await transitionControlledDiscrepancy({
      db,
      context: { ...CONTEXT, now: new Date("2026-10-03T15:00:00Z") },
      command: {
        discrepancyRef: "CSD-1",
        to: "escalated",
        classification: "suspected_theft",
        classificationRationale: "Sealed vial missing from locked safe; no recording error found",
      },
    });
    expect(result.regulatorNoticeDueAt?.toISOString()).toBe("2026-10-06T04:59:59.999Z");
    expect(result.lossReportDueAt?.toISOString()).toBe("2026-11-17T05:59:59.999Z");
    expect(tx.controlledSubstanceDiscrepancy.update).toHaveBeenCalledWith({
      where: { id: "disc-db" },
      data: expect.objectContaining({ status: "escalated", classification: "suspected_theft" }),
    });
  });

  it("refuses to close a theft case without its reporting evidence", async () => {
    const { db, tx } = fixture();
    tx.controlledSubstanceDiscrepancy.findFirst.mockResolvedValue(
      caseRow({ status: "escalated", classification: "suspected_theft", classificationRationale: "Missing vial" }),
    );
    await expect(
      transitionControlledDiscrepancy({
        db,
        context: CONTEXT,
        command: { discrepancyRef: "CSD-1", to: "reconciled", resolution: "Reported" },
      }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(tx.controlledSubstanceDiscrepancy.update).not.toHaveBeenCalled();
  });

  it("refuses an actor without reconcile authority", async () => {
    const { db, tx } = fixture();
    tx.controlledSubstanceDiscrepancy.findFirst.mockResolvedValue(caseRow());
    tx.controlledSubstanceHandlerAuthorization.findMany.mockResolvedValue([]);
    await expect(
      transitionControlledDiscrepancy({ db, context: CONTEXT, command: { discrepancyRef: "CSD-1", to: "contained" } }),
    ).rejects.toMatchObject({ code: "refused" });
  });
});
