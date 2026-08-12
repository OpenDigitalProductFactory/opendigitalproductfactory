import { describe, expect, it } from "vitest";

import { DATA_ASSET_REGISTRY, lookupAssetByPrismaModel, resolveField } from "./assets";

describe("payroll data-governance assets", () => {
  it.each(["PayRun", "Payslip"])(
    "governs %s as a confidential regulated employee record",
    (prismaModel) => {
      expect(lookupAssetByPrismaModel(DATA_ASSET_REGISTRY, prismaModel)).toMatchObject({
        domain: "people-hcm",
        sensitivity: "confidential",
        criticality: "high",
        lifecycleClass: "regulated-record",
        residencyClass: "local-only",
        projectionClass: "masked-content",
        purposeCapabilities: expect.arrayContaining([
          "billing-and-payments",
          "compliance-and-legal",
        ]),
      });
    },
  );

  it("masks payslip amounts and calculation components on field projections", () => {
    for (const field of [
      "grossPay",
      "taxablePay",
      "netPay",
      "totalEmployerCost",
      "earnings",
      "employeeDeductions",
      "employerCosts",
    ]) {
      expect(resolveField(DATA_ASSET_REGISTRY, `data:payslip#${field}`)).toMatchObject({
        sensitivity: "confidential",
        protection: "mask-on-read",
        projectionOverride: "masked-content",
      });
    }
  });
});
