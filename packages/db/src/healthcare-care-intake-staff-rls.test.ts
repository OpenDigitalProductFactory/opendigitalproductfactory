import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(__dirname, "../prisma/migrations/20260717032000_allow_staff_intake_review/migration.sql"),
  "utf8",
);

describe("healthcare intake staff review RLS", () => {
  it("adds purpose-and-actor-bound select policies without replacing patient policies", () => {
    expect(migration).toContain("FOR SELECT USING");
    expect(migration).toContain("app.care_intake_staff_principal_id");
    expect(migration).toContain("app.care_intake_access_purpose");
    expect(migration).toContain("intake-review");
    expect(migration).not.toContain("_context_policy';\n    EXECUTE format('DROP POLICY");
  });

  it("limits staff mutation policy to access-grant revocation updates", () => {
    expect(migration).toContain('CareIntakeAccessGrant_staff_revoke_update_policy');
    expect(migration.match(/FOR UPDATE/g)).toHaveLength(1);
    expect(migration).not.toContain("FOR INSERT");
    expect(migration).not.toContain("FOR DELETE");
  });
});
