import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/20260727221500_backfill_card_payment_processing_proposal/migration.sql",
  ),
  "utf8",
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Prisma model ${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("data processing governance schema", () => {
  it("persists organization-owned processing activities with stable scope and approval facts", () => {
    const activity = model("DataProcessingActivity");

    for (const field of [
      "activityId",
      "organizationId",
      "ownerRef",
      "purposeKey",
      "status",
      "assetIds",
      "fieldIds",
      "dataCategories",
      "subjectTypes",
      "authorityRefs",
      "recipientRefs",
      "destinationClasses",
      "residencyConstraints",
      "transferConstraints",
      "lifecycleClassIds",
      "highRisk",
      "dpiaRequired",
      "effectiveFrom",
      "effectiveUntil",
      "reviewAt",
      "confirmedAt",
      "confirmedByRef",
      "provenance",
    ]) {
      expect(activity).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(activity).toContain("@@unique([organizationId, activityId])");
  });

  it("persists bounded policy exceptions and stable links to executable policy", () => {
    const exception = model("DataPolicyException");

    for (const field of [
      "exceptionId",
      "organizationId",
      "status",
      "scope",
      "approverRef",
      "approvedAt",
      "rationale",
      "compensatingControl",
      "expiresAt",
      "remediationItemId",
    ]) {
      expect(exception).toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(model("Policy")).toMatch(/\bexecutablePolicyIds\b/);
    expect(model("PolicyRequirement")).toMatch(/\bexecutablePolicyIds\b/);
  });

  it("backfills only provenance-linked review proposals from trustworthy settings", () => {
    expect(migration).toContain('"handlesCardPayments" = true');
    expect(migration).toContain("'review'");
    expect(migration).toContain("'sourceField', 'BusinessContext.handlesCardPayments'");
    expect(migration).not.toMatch(
      /INSERT INTO "DataProcessingActivity"[\s\S]*?VALUES[\s\S]*?'confirmed'/,
    );
  });
});
