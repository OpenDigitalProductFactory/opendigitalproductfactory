import { describe, expect, it, vi } from "vitest";
import {
  netFromComponents,
  replacePeriodComponents,
  summariseComponents,
  type PeriodComponentClient,
} from "./tax-period-components";

describe("summariseComponents", () => {
  it("reads an absent kind as zero", () => {
    const totals = summariseComponents([{ componentKind: "sales_output", amount: 100 }]);
    expect(totals.sales_output).toBe(100);
    expect(totals.employee_withheld).toBe(0);
  });

  it("sums repeated kinds rather than letting the last one win", () => {
    const totals = summariseComponents([
      { componentKind: "employee_withheld", amount: 10.11 },
      { componentKind: "employee_withheld", amount: 20.22 },
    ]);
    expect(totals.employee_withheld).toBe(30.33);
  });
});

describe("netFromComponents", () => {
  it("subtracts recoverable input tax and adds output tax", () => {
    const net = netFromComponents(
      summariseComponents([
        { componentKind: "sales_output", amount: 1000 },
        { componentKind: "sales_input", amount: 250 },
      ]),
    );
    expect(net).toBe(750);
  });

  it("ADDS employee-withheld rather than netting it off", () => {
    // Withheld money is not the company's, but it is still owed to the
    // authority. Netting it off would understate what must be remitted.
    const net = netFromComponents(
      summariseComponents([
        { componentKind: "employee_withheld", amount: 4200 },
        { componentKind: "employer_contribution", amount: 1800 },
      ]),
    );
    expect(net).toBe(6000);
  });

  it("carries a manual adjustment", () => {
    const net = netFromComponents(
      summariseComponents([{ componentKind: "sales_output", amount: 100 }]),
      -25,
    );
    expect(net).toBe(75);
  });
});

describe("replacePeriodComponents", () => {
  function client() {
    return {
      taxObligationPeriodComponent: {
        deleteMany: vi.fn(async (_args: unknown) => ({})),
        createMany: vi.fn(async (_args: unknown) => ({})),
      },
    } satisfies PeriodComponentClient;
  }

  it("drops zero amounts instead of writing empty components", async () => {
    const db = client();
    const kept = await replacePeriodComponents(
      db,
      "period-1",
      [
        { componentKind: "employee_withheld", amount: 500 },
        { componentKind: "employer_contribution", amount: 0 },
      ],
      () => "TPC-1",
    );
    expect(kept).toEqual([{ componentKind: "employee_withheld", amount: 500 }]);
    const call = db.taxObligationPeriodComponent.createMany.mock.calls[0]![0] as {
      data: unknown[];
    };
    expect(call.data).toHaveLength(1);
  });

  it("clears the old rows first so a re-run cannot leave a stale liability", async () => {
    // The failure this prevents: a corrected run that no longer withholds, on a
    // period that keeps reporting the withholding from the previous run.
    const db = client();
    await replacePeriodComponents(db, "period-1", [], () => "TPC-1");
    expect(db.taxObligationPeriodComponent.deleteMany).toHaveBeenCalledWith({
      where: { periodId: "period-1" },
    });
    expect(db.taxObligationPeriodComponent.createMany).not.toHaveBeenCalled();
  });

  it("rounds to cents at the boundary", async () => {
    const db = client();
    const kept = await replacePeriodComponents(
      db,
      "period-1",
      [{ componentKind: "sales_output", amount: 10.005 }],
      () => "TPC-1",
    );
    expect(kept[0]!.amount).toBe(10.01);
  });
});
