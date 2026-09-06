import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TABLE_CLASSIFICATION } from "./table-classification";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema/integrations.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "prisma/migrations/20260822044500_add_external_channel_projection/migration.sql"),
  "utf8",
);

describe("ExternalChannelProjection schema", () => {
  it("enforces one source binding and one non-null remote binding in the database", () => {
    expect(schema).toContain("model ExternalChannelProjection {");
    expect(schema).toContain("@@unique([connectorKey, connectionId, sourceType, sourceRef, resourceKind, locale]");
    expect(schema).toContain("@@unique([connectorKey, connectionId, resourceKind, externalRef]");
    expect(migration).toContain('CREATE UNIQUE INDEX "ExternalChannelProjection_source_binding_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "ExternalChannelProjection_remote_binding_key"');
  });

  it("indexes the credential FK and hot connection/state and source lookup paths", () => {
    expect(schema).toContain("@@index([credentialId])");
    expect(schema).toContain("@@index([connectionId])");
    expect(schema).toContain("@@index([connectorKey, connectionId, state, updatedAt])");
    expect(schema).toContain("@@index([sourceType, sourceRef])");
    expect(migration).toContain('FOREIGN KEY ("credentialId") REFERENCES "IntegrationCredential"("id")');
    expect(migration).toContain('FOREIGN KEY ("connectionId") REFERENCES "IntegrationCredential"("integrationId")');
  });

  it("uses governed closed sets and the canonical record lifecycle convention", () => {
    expect(schema).toMatch(/\bsourceType\s+ExternalChannelProjectionSourceType\b/);
    expect(schema).toMatch(/\blifecycle\s+RecordLifecycle\b/);
    expect(schema).toMatch(/\blifecycleAt\s+DateTime\?/);
    expect(schema).not.toContain("retiredAt");
    expect(migration).toContain('CREATE TYPE "ExternalChannelProjectionSourceType"');
    expect(migration).toContain('"lifecycle" "RecordLifecycle" NOT NULL DEFAULT \'active\'');
  });

  it("classifies compact projection identity and drift metadata as internal", () => {
    expect(TABLE_CLASSIFICATION.ExternalChannelProjection).toBe("internal");
  });
});
