import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(import.meta.dirname, "../prisma/schema.prisma"), "utf8");

describe("Founder Hub partner business ownership", () => {
  it("keeps the reseller company distinct from customer and human identity", () => {
    expect(schema).toContain("model PartnerAccount {");
    expect(schema).toMatch(/model PartnerAccount \{[\s\S]*organizationId\s+String[\s\S]*federationLinkId\s+String\?/);
    expect(schema).not.toMatch(/model PartnerAccount \{[\s\S]*passwordHash/);
  });

  it("owns agreements locally while referencing offering and contribution owners", () => {
    expect(schema).toContain("model PartnerAgreement {");
    expect(schema).toContain("model PartnerEntitlement {");
    expect(schema).toContain("model PartnerSupportRoute {");
    expect(schema).toContain("model PartnerContributionRecognition {");
    expect(schema).toMatch(/model PartnerEntitlement \{[\s\S]*serviceOffering\s+ServiceOffering\?/);
    expect(schema).toMatch(/model PartnerContributionRecognition \{[\s\S]*contribution\s+HiveContributionLedger\?/);
  });

  it("supports more than one active partner without an exclusivity field", () => {
    const account = schema.match(/model PartnerAccount \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(account).toContain("@@unique([organizationId, externalOrganizationRef])");
    expect(account).not.toMatch(/exclusive/i);
  });
});
