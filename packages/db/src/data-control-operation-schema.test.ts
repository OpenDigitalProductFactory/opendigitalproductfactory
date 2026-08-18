import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/20260727235000_add_data_control_operation/migration.sql",
  ),
  "utf8",
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Prisma model ${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("data control operation schema", () => {
  it("persists immutable intent, authorization binding, reconciliation, and case evidence", () => {
    const operation = model("DataControlOperation");

    for (const field of [
      "operationId",
      "organizationId",
      "actorType",
      "actorRef",
      "actorAuthority",
      "actionKey",
      "purposeOfUse",
      "inputHash",
      "envelopeHash",
      "assetRefs",
      "fieldRefs",
      "classificationRefs",
      "policyVersions",
      "holdRevisions",
      "approvals",
      "risk",
      "idempotencyKey",
      "status",
      "authorizationDecisionId",
      "authorizationBindingHash",
      "authorizationConsumedAt",
      "governedCaseWorkItemId",
      "terminalEvidence",
      "reconciledAt",
    ]) {
      expect(operation).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(operation).toContain("@@unique([organizationId, idempotencyKey])");
    expect(operation).toContain("@@index([status, updatedAt])");
  });

  it("uses each target step as the durable outbox and verified checkpoint", () => {
    const step = model("DataControlOperationStep");

    for (const field of [
      "stepId",
      "operationId",
      "targetKey",
      "targetType",
      "pepKey",
      "sequence",
      "status",
      "idempotencyKey",
      "attempt",
      "cursor",
      "targetReceipt",
      "verificationReceipt",
      "errorClass",
      "nextRetryAt",
      "compensable",
      "compensationKey",
      "compensationReceipt",
      "leaseOwner",
      "leaseExpiresAt",
      "appliedAt",
      "verifiedAt",
      "compensatedAt",
    ]) {
      expect(step).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(step).toContain("@@unique([operationId, targetKey])");
    expect(step).toMatch(/\bidempotencyKey\s+String\s+@unique/);
    expect(step).toContain("@@index([status, nextRetryAt])");
    expect(step).toContain("@@index([leaseExpiresAt])");
  });

  it("is additive and never fabricates legacy intent through a backfill", () => {
    expect(migration).toContain('CREATE TABLE "DataControlOperation"');
    expect(migration).toContain('CREATE TABLE "DataControlOperationStep"');
    expect(migration).toContain("@migration-safety: data-safe");
    expect(migration).not.toMatch(/INSERT INTO "DataControlOperation"/);
    expect(migration).not.toMatch(/UPDATE "DataControlOperation"/);
  });
});
