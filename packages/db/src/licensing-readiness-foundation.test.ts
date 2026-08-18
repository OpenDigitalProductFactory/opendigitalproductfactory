import { describe, expect, it } from "vitest";
import { prisma } from "./client";
import { readCanonicalPrismaSchema } from "./schema-source";

function readSchema(): string {
  return readCanonicalPrismaSchema();
}

function extractModelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\n\\}`, "m"));
  return match?.[1] ?? "";
}

describe("licensing readiness foundation", () => {
  it("registers the licensing readiness models in the Prisma runtime model map", () => {
    expect("licenseRequirementReference" in prisma).toBe(true);
    expect("organizationLicenseProfile" in prisma).toBe(true);
    expect("organizationLicenseRecord" in prisma).toBe(true);
    expect("personLicenseRecord" in prisma).toBe(true);
    expect("licenseDisplayObligation" in prisma).toBe(true);
    expect("licenseFeeSchedule" in prisma).toBe(true);
    expect("licenseReadinessIssue" in prisma).toBe(true);
  });

  it("anchors person-held credentials to PrincipalAlias rather than employee or user tables", () => {
    const schema = readSchema();
    const personLicenseBlock = extractModelBlock(schema, "PersonLicenseRecord");

    expect(personLicenseBlock).toContain("principalAliasId");
    expect(personLicenseBlock).not.toContain("employeeProfileId");
    expect(personLicenseBlock).not.toContain("userId");
    expect(personLicenseBlock).not.toContain("customerContactId");
  });

  it("keeps the licensing requirement model separate from tax registrations", () => {
    const schema = readSchema();
    const requirementBlock = extractModelBlock(schema, "LicenseRequirementReference");

    expect(requirementBlock).toContain("requirementRefId");
    expect(requirementBlock).toContain("requirementType");
    expect(requirementBlock).not.toContain("taxTypes");
    expect(requirementBlock).not.toContain("filingUrl");
    expect(requirementBlock).not.toContain("paymentUrl");
  });
});
