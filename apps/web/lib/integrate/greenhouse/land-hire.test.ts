import { describe, expect, it, vi } from "vitest";
import { landGreenhouseHire, type GreenhouseHire, type HireLandingClient } from "./land-hire";

function hire(overrides: Partial<GreenhouseHire> = {}): GreenhouseHire {
  return {
    candidateId: "cand-1",
    applicationId: "app-1",
    firstName: "Ana",
    lastName: "López",
    displayName: "Ana López",
    workEmail: "ana@example.com",
    phoneWork: null,
    startDate: "2026-09-01",
    ...overrides,
  };
}

function fakeDb(opts: {
  existingRef?: { canonicalId: string } | null;
  refCreateThrows?: boolean;
}) {
  const findUnique = vi.fn().mockResolvedValue(opts.existingRef ?? null);
  const refCreate = opts.refCreateThrows
    ? vi.fn().mockRejectedValue(new Error("unique constraint"))
    : vi.fn().mockResolvedValue({});
  const empCreate = vi.fn().mockResolvedValue({ id: "emp-cuid-1" });
  const db: HireLandingClient = {
    masterDataSourceRef: { findUnique, create: refCreate },
    employeeProfile: { create: empCreate },
  };
  return { db, findUnique, refCreate, empCreate };
}

describe("landGreenhouseHire", () => {
  it("creates an onboarding EmployeeProfile + worker crosswalk on a new hire", async () => {
    const { db, empCreate, refCreate } = fakeDb({ existingRef: null });

    const result = await landGreenhouseHire(db, hire());

    expect(result).toEqual({ landed: true, employeeProfileId: "emp-cuid-1" });
    expect(empCreate).toHaveBeenCalledTimes(1);
    const empData = empCreate.mock.calls[0][0].data;
    expect(empData.status).toBe("onboarding");
    expect(empData.displayName).toBe("Ana López");
    expect(empData.workEmail).toBe("ana@example.com");
    // Deterministic employeeId keyed on the candidate id.
    expect(empData.employeeId).toContain("ghcand-1");

    expect(refCreate).toHaveBeenCalledTimes(1);
    const refData = refCreate.mock.calls[0][0].data;
    expect(refData).toMatchObject({
      domain: "worker",
      sourceSystem: "greenhouse",
      sourceEntityId: "cand-1",
      canonicalId: "emp-cuid-1",
    });
  });

  it("lands the accepted offer's compensation so the hire is payable", async () => {
    const { db, empCreate } = fakeDb({ existingRef: null });

    await landGreenhouseHire(
      db,
      hire({ compensation: { payType: "salary", annualSalary: 120000, standardAnnualHours: 2080 } }),
    );

    const empData = empCreate.mock.calls[0][0].data;
    // The exact columns lib/hr/labor-service#compensationFromEmployee reads to pay.
    expect(empData).toMatchObject({
      payType: "salary",
      annualSalary: 120000,
      standardAnnualHours: 2080,
    });
  });

  it("lands a hire with absent/malformed comp unpaid, never blocking the hire", async () => {
    const { db, empCreate } = fakeDb({ existingRef: null });

    const result = await landGreenhouseHire(db, hire({ compensation: { payType: "hourly" } }));

    expect(result).toEqual({ landed: true, employeeProfileId: "emp-cuid-1" });
    const empData = empCreate.mock.calls[0][0].data;
    expect(empData.payType).toBeUndefined();
    expect(empData.hourlyRate).toBeUndefined();
  });

  it("is idempotent — an existing crosswalk returns the existing profile, no create", async () => {
    const { db, empCreate, refCreate } = fakeDb({ existingRef: { canonicalId: "emp-existing" } });

    const result = await landGreenhouseHire(db, hire());

    expect(result).toEqual({
      landed: false,
      reason: "already-landed",
      employeeProfileId: "emp-existing",
    });
    expect(empCreate).not.toHaveBeenCalled();
    expect(refCreate).not.toHaveBeenCalled();
  });

  it("treats a lost crosswalk race (unique violation) as already-landed", async () => {
    const { db } = fakeDb({ existingRef: null, refCreateThrows: true });

    const result = await landGreenhouseHire(db, hire());

    expect(result).toEqual({
      landed: false,
      reason: "already-landed",
      employeeProfileId: "emp-cuid-1",
    });
  });
});
