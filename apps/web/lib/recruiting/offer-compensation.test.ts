import { describe, expect, it, vi } from "vitest";

import {
  offerCompensationColumns,
  offerCompensationToEmployeeColumns,
  parseOfferCompensation,
} from "./offer-compensation";
import type { Compensation } from "@/lib/hr/labor";

// labor-service imports @dpf/db at module load; stub it so we can round-trip
// against the REAL payroll reader (compensationFromEmployee) without a client.
vi.mock("@dpf/db", () => ({ prisma: {} }));
import { compensationFromEmployee } from "@/lib/hr/labor-service";

describe("parseOfferCompensation", () => {
  it("accepts a valid hourly offer", () => {
    expect(parseOfferCompensation({ payType: "hourly", hourlyRate: 27.5 })).toEqual({
      payType: "hourly",
      hourlyRate: 27.5,
    });
  });

  it("accepts a valid salary offer, with and without standard hours", () => {
    expect(parseOfferCompensation({ payType: "salary", annualSalary: 120000 })).toEqual({
      payType: "salary",
      annualSalary: 120000,
    });
    expect(
      parseOfferCompensation({ payType: "salary", annualSalary: 120000, standardAnnualHours: 2080 }),
    ).toEqual({ payType: "salary", annualSalary: 120000, standardAnnualHours: 2080 });
  });

  it("ignores extra keys (currency, notes) rather than rejecting", () => {
    expect(
      parseOfferCompensation({ payType: "hourly", hourlyRate: 20, currency: "MXN", notes: "x" }),
    ).toEqual({ payType: "hourly", hourlyRate: 20 });
  });

  it("returns null for absent, malformed, or incomplete comp", () => {
    expect(parseOfferCompensation(null)).toBeNull();
    expect(parseOfferCompensation(undefined)).toBeNull();
    expect(parseOfferCompensation("120000")).toBeNull();
    expect(parseOfferCompensation({})).toBeNull();
    expect(parseOfferCompensation({ payType: "hourly" })).toBeNull(); // no rate
    expect(parseOfferCompensation({ payType: "salary" })).toBeNull(); // no salary
    expect(parseOfferCompensation({ payType: "equity", units: 1 })).toBeNull(); // unknown
    expect(parseOfferCompensation({ payType: "hourly", hourlyRate: -5 })).toBeNull(); // negative
  });
});

describe("offerCompensationToEmployeeColumns", () => {
  it("maps hourly to the hourly columns", () => {
    expect(offerCompensationToEmployeeColumns({ payType: "hourly", hourlyRate: 31 })).toEqual({
      payType: "hourly",
      hourlyRate: 31,
    });
  });

  it("maps salary, omitting standardAnnualHours when unset", () => {
    expect(offerCompensationToEmployeeColumns({ payType: "salary", annualSalary: 90000 })).toEqual({
      payType: "salary",
      annualSalary: 90000,
    });
    expect(
      offerCompensationToEmployeeColumns({
        payType: "salary",
        annualSalary: 90000,
        standardAnnualHours: 1950,
      }),
    ).toEqual({ payType: "salary", annualSalary: 90000, standardAnnualHours: 1950 });
  });
});

describe("the recruiting→hiring→paying seam invariant", () => {
  // What a hire WRITES must be exactly what payroll READS back to pay.
  const cases: Compensation[] = [
    { payType: "hourly", hourlyRate: 27.5 },
    { payType: "salary", annualSalary: 120000 },
    { payType: "salary", annualSalary: 120000, standardAnnualHours: 2080 },
  ];

  it.each(cases)("round-trips %o through compensationFromEmployee", (comp) => {
    const cols = offerCompensationToEmployeeColumns(comp);
    // The EmployeeProfile row after a partial write: unset comp columns are null.
    const row = {
      payType: cols.payType,
      hourlyRate: cols.hourlyRate ?? null,
      annualSalary: cols.annualSalary ?? null,
      standardAnnualHours: cols.standardAnnualHours ?? null,
    };
    expect(compensationFromEmployee(row)).toEqual(comp);
  });

  it("a hire with no usable offer comp is NOT payable (graceful, not a crash)", () => {
    expect(offerCompensationColumns(null)).toBeNull();
    expect(offerCompensationColumns({ payType: "hourly" })).toBeNull();
  });
});
