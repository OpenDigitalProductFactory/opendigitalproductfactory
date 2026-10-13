import { describe, expect, it } from "vitest";

import { CLOSE_AUTHORISATION_CONFIG_KEY, CLOSE_AUTHORISATION_SCOPE } from "./close-authorisation";
import { writeCloseAuthorisation, type CloseAuthorisationWriterDb } from "./close-authorisation-writer";

// BI-45D3BBF4 AC-1: the governed writer records who, when, why and scope, and a
// revocation keeps the grant's provenance beside its own.

function store(initial?: unknown) {
  const rows = new Map<string, unknown>(initial === undefined ? [] : [[CLOSE_AUTHORISATION_CONFIG_KEY, initial]]);
  const db: CloseAuthorisationWriterDb = {
    platformConfig: {
      findUnique: async ({ where }) => (rows.has(where.key) ? { value: rows.get(where.key) } : null),
      upsert: async ({ where, create, update }) => {
        rows.set(where.key, rows.has(where.key) ? update.value : create.value);
        return {};
      },
    },
  };
  return { rows, db };
}

const GRANT_AT = new Date("2026-10-01T09:00:00.000Z");
const REVOKE_AT = new Date("2026-10-03T09:00:00.000Z");

describe("writeCloseAuthorisation", () => {
  it("records a grant with its provenance and scope", async () => {
    const { rows, db } = store();
    const result = await writeCloseAuthorisation(db, {
      action: "grant", userId: "user-operator", reason: "Operator pre-authorised (BI-8A32EBFF).", now: GRANT_AT, maxClosuresPerRun: 10,
    });
    expect(result.ok).toBe(true);
    expect(rows.get(CLOSE_AUTHORISATION_CONFIG_KEY)).toEqual({
      schemaVersion: 1,
      scope: CLOSE_AUTHORISATION_SCOPE,
      enabled: true,
      setByUserId: "user-operator",
      setAt: GRANT_AT.toISOString(),
      reason: "Operator pre-authorised (BI-8A32EBFF).",
      maxClosuresPerRun: 10,
    });
  });

  it("revokes without erasing who granted it", async () => {
    const { rows, db } = store();
    await writeCloseAuthorisation(db, { action: "grant", userId: "user-operator", reason: "Operator pre-authorised it.", now: GRANT_AT });
    const result = await writeCloseAuthorisation(db, { action: "revoke", userId: "user-second", reason: "Pausing while reviewed.", now: REVOKE_AT });
    expect(result.ok).toBe(true);
    expect(rows.get(CLOSE_AUTHORISATION_CONFIG_KEY)).toMatchObject({
      enabled: false,
      setByUserId: "user-operator",
      setAt: GRANT_AT.toISOString(),
      revokedByUserId: "user-second",
      revokedAt: REVOKE_AT.toISOString(),
      revokeReason: "Pausing while reviewed.",
    });
  });

  it("refuses to revoke when nothing is in force", async () => {
    const { db } = store();
    expect(await writeCloseAuthorisation(db, { action: "revoke", userId: "u", reason: "Nothing to revoke here.", now: REVOKE_AT }))
      .toEqual({ ok: false, error: "There is no pre-authorisation in force to revoke." });
  });

  it("refuses a grant without a reason worth keeping", async () => {
    const { rows, db } = store();
    const result = await writeCloseAuthorisation(db, { action: "grant", userId: "u", reason: "ok", now: GRANT_AT });
    expect(result.ok).toBe(false);
    expect(rows.size).toBe(0);
  });
});
