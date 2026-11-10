import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "test-user-1" } }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    reviewCycle: { findUnique: vi.fn(), update: vi.fn() },
    employeeProfile: { findMany: vi.fn() },
    businessContext: { findFirst: vi.fn() },
    reviewInstance: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@dpf/db";

import { activateReviewCycle } from "./reviews";

const CYCLE = { id: "cycle-row-1", status: "draft" };

function employee(
  id: string,
  displayName: string,
  classification: string | null,
  jurisdictionSlug: string | null = "us",
) {
  return {
    id,
    displayName,
    managerEmployeeId: "mgr-1",
    employmentType: classification ? { classification } : null,
    workLocation: { id: "loc-1", jurisdictionSlug },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.reviewCycle.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CYCLE);
  (prisma.businessContext.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    employsIn: ["us"],
  });
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("activateReviewCycle applies the co-employment control (BI-B506AD2E)", () => {
  it("enrols employees", async () => {
    (prisma.employeeProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      employee("e1", "Ada Employee", "employee"),
      employee("e2", "Ben Employee", "employee"),
    ]);

    const result = await activateReviewCycle("RC-1");

    expect(result.success).toBe(true);
    expect(result.instancesCreated).toBe(2);
    expect(result.excludedFromReview).toEqual([]);
  });

  it("refuses to enrol a contractor, and says why", async () => {
    // This is the defect the control closes: performance review is an
    // employment process, and enrolling a contingent worker in one creates
    // behavioural-control evidence automatically and with a timestamp.
    (prisma.employeeProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      employee("e1", "Ada Employee", "employee"),
      employee("e2", "Cleo Contractor", "contractor_direct"),
    ]);

    const result = await activateReviewCycle("RC-1");

    expect(result.instancesCreated).toBe(1);
    expect(result.excludedFromReview).toHaveLength(1);
    expect(result.excludedFromReview?.[0].displayName).toBe("Cleo Contractor");
    expect(result.excludedFromReview?.[0].explanation).toContain("contractor_direct");
  });

  it("refuses to enrol a volunteer", async () => {
    (prisma.employeeProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      employee("e1", "Vic Volunteer", "volunteer"),
    ]);

    const result = await activateReviewCycle("RC-1");

    expect(result.instancesCreated).toBe(0);
    expect(result.excludedFromReview).toHaveLength(1);
  });

  it("refuses a worker with no recorded classification rather than assuming employee", async () => {
    (prisma.employeeProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      employee("e1", "Una Unclassified", null),
    ]);

    const result = await activateReviewCycle("RC-1");

    expect(result.instancesCreated).toBe(0);
    expect(result.excludedFromReview?.[0].explanation).toMatch(/classification/i);
  });

  it("refuses when the work location has no jurisdiction — the upgrade-day case", async () => {
    // Every existing WorkLocation row is NULL after D2's migration, by design.
    // An install therefore enrols nobody until jurisdictions are set, and the
    // operator is told exactly that rather than seeing a silent empty cycle.
    (prisma.employeeProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      employee("e1", "Ada Employee", "employee", null),
    ]);

    const result = await activateReviewCycle("RC-1");

    expect(result.instancesCreated).toBe(0);
    expect(result.excludedFromReview?.[0].explanation).toMatch(/jurisdiction/i);
  });

  it("never silently drops a refused worker", async () => {
    (prisma.employeeProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      employee("e1", "Cleo Contractor", "contractor_direct"),
      employee("e2", "Vic Volunteer", "volunteer"),
      employee("e3", "Una Unclassified", null),
    ]);

    const result = await activateReviewCycle("RC-1");

    // An unexplained absence from a review cycle reads as a bug, and an operator
    // who cannot see why will go around the control.
    expect(result.excludedFromReview).toHaveLength(3);
    for (const excluded of result.excludedFromReview ?? []) {
      expect(excluded.explanation.trim().length).toBeGreaterThan(0);
    }
  });
});
