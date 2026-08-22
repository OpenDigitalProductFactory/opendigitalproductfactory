import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const initialMigration = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/20260822164000_subject_agnostic_scheduling_and_resources/migration.sql",
  ),
  "utf8",
);
const alignmentMigration = readFileSync(
  resolve(
    import.meta.dirname,
    "../prisma/migrations/20260822172800_subject_reference_guard_alignment/migration.sql",
  ),
  "utf8",
);
const migration = `${initialMigration}\n${alignmentMigration}`;

describe("subject-agnostic scheduling and resource migration", () => {
  it("expands, backfills, validates, and then requires root subject identity", () => {
    const expand = migration.search(
      /ALTER TABLE "CareAppointment"\s+ADD COLUMN "subjectType" TEXT/,
    );
    const backfill = migration.indexOf(
      'UPDATE "CareAppointment" SET "subjectType" = \'patient-profile\'',
    );
    const constrain = migration.indexOf(
      'ALTER TABLE "CareAppointment" ALTER COLUMN "subjectType" SET NOT NULL',
    );
    const makeOpenVocabularyExplicit = migration.indexOf(
      'RENAME COLUMN "subjectType" TO "subjectKindSlug"',
    );

    expect(expand).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(expand);
    expect(constrain).toBeGreaterThan(backfill);
    expect(makeOpenVocabularyExplicit).toBeGreaterThan(constrain);
    expect(initialMigration).toContain('"subjectId" = "patientProfileId"');
    expect(alignmentMigration).toContain(
      'RENAME COLUMN "subjectId" TO "subjectRef"',
    );
    expect(migration).toContain('CONSTRAINT "CareAppointment_subject_contract_check"');
    expect(migration).toContain('CONSTRAINT "CareIntakePacket_subject_contract_check"');
  });

  it("retains clinical scheduling invariants while making them conditional", () => {
    expect(migration).toContain('ALTER COLUMN "patientProfileId" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "visitTypeId" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "locationId" DROP NOT NULL');
    expect(migration).toMatch(
      /"subjectType" = 'patient-profile'[\s\S]*?"visitTypeId" IS NOT NULL[\s\S]*?"locationId" IS NOT NULL/,
    );
    expect(migration).not.toMatch(/DROP COLUMN "recallAt"/);
    expect(migration).not.toMatch(/DROP COLUMN "overbookAuthorizedByPrincipalId"/);
    expect(migration).not.toMatch(/DROP COLUMN "footprint(Start|End)"/);
  });

  it("moves generic intake joins to packet and organization while preserving patient branches", () => {
    expect(migration).toContain(
      'CareIntakeResponse_packetId_organizationId_fkey',
    );
    expect(migration).toContain(
      'CareIntakeAccessGrant_packetId_organizationId_fkey',
    );
    expect(migration).toContain(
      'CareIntakeAccessGrant_patientProfileId_organizationId_fkey',
    );
    expect(migration).toContain(
      'CareIntakeStatusEvent_patientProfileId_organizationId_fkey',
    );
    expect(migration).toContain(
      'CareIntakeResponse_supersedesResponseId_organizationId_idx',
    );
    expect(migration).not.toContain(
      'DROP CONSTRAINT "CareConsentAttestation_packetId_organizationId_patientProfileId_fkey"',
    );
    expect(migration).not.toContain(
      'DROP CONSTRAINT "CareCoverageEvidence_packetId_organizationId_patientProfileId_fkey"',
    );
  });

  it("backfills hospitality resources and availability by deterministic provenance", () => {
    expect(migration).toContain('INSERT INTO "Resource"');
    expect(migration).toContain("'HospitalityResource:' || legacy.id");
    expect(migration).toContain('INSERT INTO "ResourceAvailability"');
    expect(migration).toContain(
      "'HospitalityResourceAvailability:' || legacy.id",
    );
    expect(migration).toContain("'legacy-status:' || legacy.status");
    expect(migration).toContain("'legacy-kind:' || legacy.kind");
    expect(migration).toContain("resource reconciliation failed");
    expect(migration).toContain("availability reconciliation failed");
    expect(migration.match(/ON CONFLICT \("sourceRef"\) DO UPDATE/g)).toHaveLength(2);
    expect(migration).not.toMatch(
      /DELETE FROM "(HospitalityResource|HospitalityResourceAvailability)"/,
    );
  });

  it("contains only this backlog item's persistent changes", () => {
    expect(migration).not.toContain('ALTER TABLE "AiProviderFinanceProfile"');
    expect(migration).not.toContain('ALTER TABLE "FinanceWorkItem"');
    expect(migration).not.toContain('DROP TYPE');
    expect(migration).not.toContain('DROP COLUMN');
  });
});
