import { describe, expect, it, vi } from "vitest";

import {
  prepareManualNachaBatch,
  recordManualDisbursement,
  type ManualDisbursementClient,
  type ManualDisbursementLine,
  type PrepareManualBatchInput,
} from "./manual-disbursement";

const originator: PrepareManualBatchInput["originator"] = {
  companyName: "Infinitum Motors",
  companyId: "1234567890",
  originatingDfiRouting: "091000019",
  immediateDestination: "091000019",
  immediateOrigin: "1234567890",
  immediateDestinationName: "Wells Fargo",
  immediateOriginName: "Infinitum Motors",
};

function line(overrides: Partial<ManualDisbursementLine> = {}): ManualDisbursementLine {
  return {
    payslipId: "ps-1",
    employeeProfileId: "emp-1",
    receiverName: "Maria Reyes",
    netPay: 2500,
    bank: { routingNumber: "021000021", accountNumber: "123456789", accountType: "checking" },
    ...overrides,
  };
}

describe("prepareManualNachaBatch", () => {
  it("builds a balanced NACHA file for the payable lines only", () => {
    const artifact = prepareManualNachaBatch({
      originator,
      effectiveDate: new Date(Date.UTC(2026, 8, 15)),
      fileCreated: new Date(Date.UTC(2026, 8, 11, 14, 30)),
      lines: [
        line(),
        line({ payslipId: "ps-2", employeeProfileId: "emp-2", netPay: 1800.5 }),
        line({ payslipId: "ps-3", employeeProfileId: "emp-3", netPay: 0 }), // not payable
      ],
    });

    expect(artifact.payableCount).toBe(2);
    expect(artifact.totalCents).toBe(430050); // 250000 + 180050
    const recs = artifact.nachaFile.split("\r\n").filter((l) => l.length > 0);
    expect(recs.every((l) => l.length === 94)).toBe(true);
    expect(recs.length % 10).toBe(0);
  });
});

describe("recordManualDisbursement", () => {
  function fakeDb() {
    const update = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (fn: (tx: { payslip: { update: typeof update } }) => Promise<unknown>) =>
      fn({ payslip: { update } }),
    );
    const db: ManualDisbursementClient = {
      $transaction: transaction as ManualDisbursementClient["$transaction"],
    };
    return { db, update, transaction };
  }

  const attestation = {
    attestedBy: "controller-1",
    attestedAt: new Date(Date.UTC(2026, 8, 15, 16, 0)),
    bankReference: "ACH-BATCH-8842",
  };

  it("marks every payslip paid as of the attestation time", async () => {
    const { db, update, transaction } = fakeDb();

    const result = await recordManualDisbursement(db, {
      payslipIds: ["ps-1", "ps-2"],
      attestation,
    });

    expect(result.disbursed).toEqual(["ps-1", "ps-2"]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: "ps-1", disbursementStatus: "pending" },
      data: { disbursementStatus: "paid", paidAt: attestation.attestedAt },
    });
    expect(result.attestation.bankReference).toBe("ACH-BATCH-8842");
  });

  it("refuses to mark paid without a bank reference (no proof of payment)", async () => {
    const { db, update } = fakeDb();
    await expect(
      recordManualDisbursement(db, {
        payslipIds: ["ps-1"],
        attestation: { ...attestation, bankReference: "  " },
      }),
    ).rejects.toThrow(/bankReference/);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an unidentified attester or duplicate payslip target", async () => {
    const { db, update } = fakeDb();
    await expect(
      recordManualDisbursement(db, {
        payslipIds: ["ps-1"],
        attestation: { ...attestation, attestedBy: " " },
      }),
    ).rejects.toThrow(/attestedBy/);
    await expect(
      recordManualDisbursement(db, {
        payslipIds: ["ps-1", "ps-1"],
        attestation,
      }),
    ).rejects.toThrow(/duplicate payslip/);
    expect(update).not.toHaveBeenCalled();
  });
});
