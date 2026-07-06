// lib/hr/compensation-data.ts — read model for the employee compensation panel.
//
// Serializes EmployeeProfile compensation columns (Decimal → number) so a
// client component can render/edit them. Writes go through the governed
// setEmployeeCompensation action in lib/actions/workforce.ts.

import { prisma } from "@dpf/db";

export type EmployeeCompensationRow = {
  employeeProfileId: string;
  displayName: string;
  employeeId: string;
  payType: "hourly" | "salary" | null;
  hourlyRate: number | null;
  annualSalary: number | null;
  standardAnnualHours: number | null;
};

export async function getEmployeeCompensationRows(): Promise<EmployeeCompensationRow[]> {
  const employees = await prisma.employeeProfile.findMany({
    where: { status: { notIn: ["inactive"] } },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      employeeId: true,
      payType: true,
      hourlyRate: true,
      annualSalary: true,
      standardAnnualHours: true,
    },
  });

  return employees.map((e) => ({
    employeeProfileId: e.id,
    displayName: e.displayName,
    employeeId: e.employeeId,
    payType: e.payType === "hourly" || e.payType === "salary" ? e.payType : null,
    hourlyRate: e.hourlyRate != null ? Number(e.hourlyRate) : null,
    annualSalary: e.annualSalary != null ? Number(e.annualSalary) : null,
    standardAnnualHours: e.standardAnnualHours,
  }));
}
