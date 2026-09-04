import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260904113000_async_inference_durable_lifecycle/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("durable async inference lifecycle persistence", () => {
  it("enforces one closed status set without destructively rewriting the legacy column", () => {
    for (const status of [
      "pending",
      "start_indeterminate",
      "running",
      "completed",
      "failed",
      "cancelled",
      "expired",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(schema).toMatch(/status\s+String\s+@default\("pending"\)/);
    expect(migration).toContain('CONSTRAINT "AsyncInferenceOp_status_check"');
    expect(migration).toContain('CONSTRAINT "AsyncInferenceOperationTransition_status_closed_set"');
    expect(migration).toContain("refusing status constraint");
    expect(migration).not.toContain('ALTER COLUMN "status" TYPE');
    expect(migration).not.toContain('CREATE TYPE "AsyncInferenceOperationStatus"');
  });

  it("binds every version-one identity to exactly one TaskRun or Workroom", () => {
    expect(schema).toContain("@@unique([authorityScopeKey, requestKey])");
    expect(schema).toContain("@@index([authorityScopeKey, createdAt, id])");
    expect(schema).toMatch(/taskRun\s+TaskRun\?.*onDelete: Restrict/);
    expect(schema).toMatch(/workroom\s+Workroom\?.*onDelete: Restrict/);
    expect(migration).toContain('"identityVersion" = 1');
    expect(migration).toContain('(("taskRunId" IS NOT NULL)::int + ("workroomId" IS NOT NULL)::int) = 1');
    expect(migration).toContain('"requestDigest" ~ \'^[a-f0-9]{64}$\'');
    expect(migration).toContain('"bindingDigest" ~ \'^[a-f0-9]{64}$\'');
    expect(migration).toContain('"AsyncInferenceOp_authorityScopeKey_createdAt_id_idx"');
  });

  it("persists the provider-start fence and an ordered transition outbox", () => {
    expect(schema).toContain("startClaimFence");
    expect(schema).toContain("startAttemptedAt");
    expect(schema).toContain("model AsyncInferenceOperationTransition");
    expect(schema).toContain("@@unique([operationId, sequence])");
    expect(migration).toContain('CONSTRAINT "AsyncInferenceOp_provider_handle_check"');
    expect(migration).toContain('"status" <> \'running\' OR "operationId" IS NOT NULL');
    expect(migration).toContain('CREATE TABLE "AsyncInferenceOperationTransition"');
    expect(migration).toContain('CONSTRAINT "AsyncInferenceOperationTransition_sequence_check"');
  });

  it("preserves legacy operations without inventing missing authority", () => {
    expect(migration).toContain('ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 0');
    expect(migration).not.toContain('ALTER COLUMN "identityVersion" SET DEFAULT 1');
    expect(schema).toContain("identityVersion   Int     @default(0)");
    expect(migration).toContain("jsonb_build_object('identityVersion', 0, 'backfilled', true)");
    expect(migration).toContain('"createdAt",\n  0,\n  "createdAt"');
    expect(migration).not.toMatch(/UPDATE\s+"AsyncInferenceOp"[\s\S]*"(?:taskRunId|workroomId)"/i);
  });
});
