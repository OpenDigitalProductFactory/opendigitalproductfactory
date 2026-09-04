import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  __dirname,
  "../prisma/migrations/20260717035500_enforce_care_intake_evidence_immutability/migration.sql",
), "utf8");

describe("care intake reviewed evidence immutability migration", () => {
  it("freezes consent and coverage payload fields while leaving review fields mutable", () => {
    expect(sql).toContain("prevent_care_consent_attestation_payload_mutation");
    expect(sql).toContain("prevent_care_coverage_evidence_payload_mutation");
    expect(sql).toContain('OLD."signatureDigest" IS DISTINCT FROM NEW."signatureDigest"');
    expect(sql).toContain('OLD."evidenceDigest" IS DISTINCT FROM NEW."evidenceDigest"');
    expect(sql).not.toContain('OLD."status" IS DISTINCT FROM NEW."status"');
    expect(sql).not.toContain('OLD."acceptedAt" IS DISTINCT FROM NEW."acceptedAt"');
    expect(sql).not.toContain('OLD."verifiedAt" IS DISTINCT FROM NEW."verifiedAt"');
  });

  it("prevents deletion of both retained evidence types", () => {
    expect(sql).toContain('"CareConsentAttestation_no_delete"');
    expect(sql).toContain('"CareCoverageEvidence_no_delete"');
    expect(sql.match(/prevent_care_intake_evidence_delete/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
