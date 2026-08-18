import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/20260720120000_federation_pairing_session/migration.sql",
  ),
  "utf8",
);

describe("federation pairing session persistence", () => {
  it("keeps ephemeral pairing separate from invitation and relationship authority", () => {
    expect(schema).toContain("model FederationPairingSession {");
    expect(schema).toMatch(
      /model FederationPairingSession \{[\s\S]*bootstrapToken\s+FederationBootstrapToken\?\s+@relation/,
    );
    expect(schema).not.toContain("model FederationPairingLink {");
  });

  it("hashes incoming secrets and encrypts replayable credentials", () => {
    expect(schema).toMatch(/model FederationPairingSession \{[\s\S]*pairingSecretHash\s+String\?\s+@unique/);
    expect(schema).toMatch(/model FederationPairingSession \{[\s\S]*pairingSecretEnc\s+String\?/);
    expect(schema).toMatch(/model FederationPairingSession \{[\s\S]*bootstrapTokenEnc\s+String\?/);
    expect(schema).not.toMatch(/model FederationPairingSession \{[\s\S]*pairingSecret\s+String\s/);
  });

  it("migrates an additive table with lifecycle and expiry indexes", () => {
    expect(migration).toContain('CREATE TABLE "FederationPairingSession"');
    expect(migration).toContain('CREATE UNIQUE INDEX "FederationPairingSession_pairingId_key"');
    expect(migration).toContain('CREATE INDEX "FederationPairingSession_status_expiresAt_idx"');
    expect(migration).toContain('FOREIGN KEY ("bootstrapTokenId")');
  });
});
