import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../prisma/migrations/20260519143000_self_upgrade_runs/migration.sql", import.meta.url),
  "utf8"
);

describe("20260519143000_self_upgrade_runs migration DDL", () => {
  it("creates the SelfUpgradeRun table", () => {
    expect(sql).toContain('CREATE TABLE "SelfUpgradeRun"');
  });

  it("includes all required columns", () => {
    for (const col of ["runId", "status", "triggeredBy", "fromVersion", "toVersion", "log", "error"]) {
      expect(sql, `missing column ${col}`).toContain(`"${col}"`);
    }
  });

  it("defaults status to pending", () => {
    expect(sql).toContain("DEFAULT 'pending'");
  });

  it("has a unique index on runId", () => {
    expect(sql).toContain("SelfUpgradeRun_runId_key");
  });

  it("has an index on status", () => {
    expect(sql).toContain("SelfUpgradeRun_status_idx");
  });

  it("has an index on createdAt", () => {
    expect(sql).toContain("SelfUpgradeRun_createdAt_idx");
  });
});

describe("20260519143000_self_upgrade_runs migration seed config", () => {
  it("inserts the portal.selfUpgrade config key", () => {
    expect(sql).toContain("'portal.selfUpgrade'");
  });

  it("seeds config with enabled:false so existing installs start disabled", () => {
    expect(sql).toContain('"enabled":false');
  });

  it("seeds config with stable channel", () => {
    expect(sql).toContain('"channel":"stable"');
  });

  it("seeds config with a 24-hour check interval", () => {
    expect(sql).toContain('"checkIntervalHours":24');
  });

  it("is idempotent — uses ON CONFLICT DO NOTHING", () => {
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("DO NOTHING");
  });
});
