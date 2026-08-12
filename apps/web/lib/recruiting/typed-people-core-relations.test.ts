// BI-7ACC38CE — typed People-Core relations for the recruiting models.
//
// Compile-time guard: the `satisfies` clauses fail `tsc` if any relation is
// dropped from the generated Prisma client, so this test locks the recruiting
// <-> People-Core edges (JobRequisition -> Position/Department/WorkLocation/
// EmploymentType/EmployeeProfile, Scorecard -> EmployeeProfile) and their
// back-relations against silent schema regression. Runtime assertions keep
// vitest honest without needing a database.

import { describe, expect, it } from "vitest";
import { Prisma } from "@dpf/db";

describe("recruiting ↔ People-Core typed relations (BI-7ACC38CE)", () => {
  it("JobRequisition can include every People-Core relation", () => {
    const include = {
      position: true,
      department: true,
      workLocation: true,
      employmentType: true,
      hiringManager: true,
      recruiter: true,
    } satisfies Prisma.JobRequisitionInclude;

    expect(Object.keys(include).sort()).toEqual([
      "department",
      "employmentType",
      "hiringManager",
      "position",
      "recruiter",
      "workLocation",
    ]);
  });

  it("Scorecard can include the submitter worker relation", () => {
    const include = { submittedBy: true } satisfies Prisma.ScorecardInclude;
    expect(include.submittedBy).toBe(true);
  });

  it("People-Core models expose the recruiting back-relations", () => {
    const position = { requisitions: true } satisfies Prisma.PositionInclude;
    const department = { requisitions: true } satisfies Prisma.DepartmentInclude;
    const workLocation = { requisitions: true } satisfies Prisma.WorkLocationInclude;
    const employmentType = { requisitions: true } satisfies Prisma.EmploymentTypeInclude;
    const employee = {
      requisitionsAsHiringManager: true,
      requisitionsAsRecruiter: true,
      scorecardsSubmitted: true,
    } satisfies Prisma.EmployeeProfileInclude;

    expect(position.requisitions).toBe(true);
    expect(department.requisitions).toBe(true);
    expect(workLocation.requisitions).toBe(true);
    expect(employmentType.requisitions).toBe(true);
    expect(Object.keys(employee)).toHaveLength(3);
  });
});
