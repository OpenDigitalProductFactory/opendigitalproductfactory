import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(import.meta.dirname, "../prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(
  import.meta.dirname,
  "../prisma/migrations/20260720100000_provider_suitability_evidence/migration.sql",
), "utf8");

describe("provider suitability evidence schema", () => {
  it("binds claim evidence to one provider connection through the existing ComplianceEvidence owner", () => {
    expect(schema).toMatch(/model ComplianceEvidence \{[\s\S]*providerConnectionId\s+String\?/);
    expect(schema).toMatch(/model ComplianceEvidence \{[\s\S]*claimKey\s+String\?/);
    expect(schema).toMatch(/model ComplianceEvidence \{[\s\S]*assertedValue\s+Json\?/);
    expect(schema).toMatch(/model ComplianceEvidence \{[\s\S]*providerConnection\s+AiProviderConnection\?/);
    expect(schema).not.toContain("model ProviderTrustEvidence {");
  });

  it("adds only nullable unknown-by-default fields and preserves existing-install safety", () => {
    expect(migration).toContain('ADD COLUMN "providerConnectionId" TEXT');
    expect(migration).toContain('ADD COLUMN "claimKey" TEXT');
    expect(migration).toContain('ADD COLUMN "assertedValue" JSONB');
    expect(migration).toContain('ADD COLUMN "validFrom" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "expiresAt" TIMESTAMP(3)');
    expect(migration).not.toMatch(/providerConnectionId" TEXT NOT NULL|claimKey" TEXT NOT NULL|DEFAULT '\{.*entitl/i);
    expect(migration).toContain("ON DELETE SET NULL");
  });

  it("adds a nullable policy-safe receipt to the existing route audit log", () => {
    expect(schema).toMatch(/model RouteDecisionLog \{[\s\S]*suitabilityReceipt\s+Json\?/);
    expect(migration).toContain('ALTER TABLE "RouteDecisionLog"');
    expect(migration).toContain('ADD COLUMN "suitabilityReceipt" JSONB');
  });
});
