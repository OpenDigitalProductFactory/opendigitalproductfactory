import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Postmark callback hardening migration", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../../packages/db/prisma/migrations/20260717211500_harden_connector_callback_dispatch/migration.sql"), "utf8");
  it("fails safely when historical inbound drafts are duplicated", () => {
    expect(sql).toContain("HAVING COUNT(*) > 1");
    expect(sql).toContain("RAISE EXCEPTION 'Duplicate inbound responder drafts must be reconciled before migration'");
  });
  it("enforces one responder draft with a partial unique index", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "OutboundDraft_inbound_source_key"');
    expect(sql).toContain("WHERE \"sourceType\" = 'inbound-channel-message' AND \"sourceId\" IS NOT NULL");
  });
});
