import { describe, expect, it } from "vitest";

import { evaluatePreconditionOrdering } from "./precondition-ordering-gate";

describe("TAK precondition and ordering gate", () => {
  it("rejects asset allocation until employee identity exists in both views", () => {
    const result = evaluatePreconditionOrdering({
      action: "allocate-employee-asset",
      prerequisites: [{
        key: "employee-identity",
        business: { required: true, satisfied: false, evidenceRef: "ea:value-stream:onboarding:identity" },
        systems: { required: true, satisfied: false, evidenceRef: "prisma:relation:Asset:employee:EmployeeProfile" },
      }],
    });
    expect(result.verdict).toBe("decline");
    expect(result.checks[0]).toMatchObject({
      key: "employee-identity", coherent: true, satisfied: false,
      evidenceRefs: ["ea:value-stream:onboarding:identity", "prisma:relation:Asset:employee:EmployeeProfile"],
    });
  });

  it("approves only after the employee identity prerequisite is satisfied", () => {
    expect(evaluatePreconditionOrdering({
      action: "allocate-employee-asset",
      prerequisites: [{
        key: "employee-identity",
        business: { required: true, satisfied: true, evidenceRef: "ea:value-stream:onboarding:identity" },
        systems: { required: true, satisfied: true, evidenceRef: "prisma:relation:Asset:employee:EmployeeProfile" },
      }],
    }).verdict).toBe("approve");
  });

  it("escalates rather than inventing order when business and systems architecture drift", () => {
    expect(evaluatePreconditionOrdering({
      action: "allocate-employee-asset",
      prerequisites: [{
        key: "employee-identity",
        business: { required: true, satisfied: true, evidenceRef: "ea:value-stream:onboarding:identity" },
        systems: { required: false, satisfied: true, evidenceRef: "prisma:model:FixedAsset#assignedToId" },
      }],
    })).toMatchObject({ verdict: "escalate", checks: [expect.objectContaining({ coherent: false })] });
  });
});
