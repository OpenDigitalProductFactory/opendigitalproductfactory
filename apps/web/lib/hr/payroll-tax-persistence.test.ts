// Amounts here are deliberately synthetic. Real statutory rates are
// operator-supplied, source-cited reference data (BI-4EB27955).

import { describe, expect, it, vi } from "vitest";
import {
  persistPayrollTaxAccruals,
  type PayrollTaxPersistenceClient,
} from "./payroll-tax-persistence";

function client() {
  let n = 0;
  return {
    taxDecisionSnapshot: {
      create: vi.fn(async (_args: unknown) => {
        n += 1;
        return { id: `snap-row-${n}`, snapshotId: `SNAP-${n}` };
      }),
    },
    taxLiabilityEntry: {
      create: vi.fn(async (_args: unknown) => {
        n += 1;
        return { id: `entry-row-${n}`, entryId: `ENT-${n}` };
      }),
    },
    taxObligationPeriodComponent: {
      deleteMany: vi.fn(async (_args: unknown) => ({})),
      createMany: vi.fn(async (_args: unknown) => ({})),
    },
  } satisfies PayrollTaxPersistenceClient;
}

const RUN = {
  payRunId: "PR-1",
  payDate: new Date("2026-03-15T00:00:00Z"),
  amounts: [
    {
      taxType: "federal_withholding" as const,
      side: "employee_withheld" as const,
      taxableAmount: 10000,
      taxAmount: 1200,
    },
    {
      taxType: "futa" as const,
      side: "employer_contribution" as const,
      taxableAmount: 7000,
      taxAmount: 42,
    },
  ],
};

const ids = () => ({
  newSnapshotId: () => "SNAP-X",
  newEntryId: () => "ENT-X",
  newComponentId: () => "TPC-X",
});

describe("persistPayrollTaxAccruals", () => {
  it("writes both a snapshot and a liability entry per tax", async () => {
    // Sales tax writes both; payroll writing only one would make payroll
    // periods total differently from sales periods.
    const db = client();
    const result = await persistPayrollTaxAccruals(db, {
      organizationTaxProfileId: "profile-1",
      run: RUN,
      registrationsByTaxType: { federal_withholding: "reg-fed", futa: "reg-fed" },
      ...ids(),
    });
    expect(db.taxDecisionSnapshot.create).toHaveBeenCalledTimes(2);
    expect(db.taxLiabilityEntry.create).toHaveBeenCalledTimes(2);
    expect(result.snapshotIds).toHaveLength(2);
    expect(result.liabilityEntryIds).toHaveLength(2);
  });

  it("dates the accrual by PAY DATE, because payment triggers the deposit", async () => {
    const db = client();
    await persistPayrollTaxAccruals(db, {
      organizationTaxProfileId: "profile-1",
      run: RUN,
      registrationsByTaxType: { federal_withholding: "reg-fed" },
      ...ids(),
    });
    const data = db.taxDecisionSnapshot.create.mock.calls[0]![0] as {
      data: { occurredAt: Date; evidence: { datedBy: string } };
    };
    expect(data.data.occurredAt).toEqual(new Date("2026-03-15T00:00:00Z"));
    expect(data.data.evidence.datedBy).toBe("pay_date");
  });

  it("carries the withheld/contribution side onto the spine", async () => {
    const db = client();
    await persistPayrollTaxAccruals(db, {
      organizationTaxProfileId: "profile-1",
      run: RUN,
      registrationsByTaxType: { federal_withholding: "reg-fed" },
      ...ids(),
    });
    const data = db.taxDecisionSnapshot.create.mock.calls[0]![0] as {
      data: { taxCode: string };
    };
    expect(data.data.taxCode).toBe("employee_withheld");
  });

  it("reports an uncovered tax type instead of silently dropping the liability", async () => {
    // Money owed to an authority the business has not registered with is
    // exactly what an operator needs told.
    const db = client();
    const result = await persistPayrollTaxAccruals(db, {
      organizationTaxProfileId: "profile-1",
      run: RUN,
      registrationsByTaxType: { federal_withholding: "reg-fed" },
      ...ids(),
    });
    expect(result.unregisteredTaxTypes).toEqual(["futa"]);
    expect(db.taxDecisionSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it("splits period components by side and nets them as both owed", async () => {
    const db = client();
    const result = await persistPayrollTaxAccruals(db, {
      organizationTaxProfileId: "profile-1",
      run: RUN,
      registrationsByTaxType: { federal_withholding: "reg-fed", futa: "reg-fed" },
      periodByRegistration: { "reg-fed": "period-1" },
      ...ids(),
    });
    expect(result.componentsByPeriod["period-1"]).toEqual([
      { componentKind: "employee_withheld", amount: 1200 },
      { componentKind: "employer_contribution", amount: 42 },
    ]);
    expect(result.netByPeriod["period-1"]).toBe(1242);
  });

  it("writes snapshot and liability with no period when none is supplied", async () => {
    // Period generation picks them up later by sourceType, as sales tax does.
    const db = client();
    const result = await persistPayrollTaxAccruals(db, {
      organizationTaxProfileId: "profile-1",
      run: RUN,
      registrationsByTaxType: { federal_withholding: "reg-fed" },
      ...ids(),
    });
    const entry = db.taxLiabilityEntry.create.mock.calls[0]![0] as {
      data: { periodId: string | null };
    };
    expect(entry.data.periodId).toBeNull();
    expect(result.componentsByPeriod).toEqual({});
    expect(db.taxObligationPeriodComponent.createMany).not.toHaveBeenCalled();
  });

  it("records nothing at all for a run with no taxes", async () => {
    const db = client();
    const result = await persistPayrollTaxAccruals(db, {
      organizationTaxProfileId: "profile-1",
      run: { payRunId: "PR-2", payDate: new Date("2026-03-15T00:00:00Z"), amounts: [] },
      registrationsByTaxType: { federal_withholding: "reg-fed" },
      ...ids(),
    });
    expect(result.snapshotIds).toEqual([]);
    expect(result.unregisteredTaxTypes).toEqual([]);
    expect(db.taxDecisionSnapshot.create).not.toHaveBeenCalled();
  });
});
