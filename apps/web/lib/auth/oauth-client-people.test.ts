import { describe, expect, it } from "vitest";

import { listClientPeople, revokeClientPersonGrants, type ClientPeopleDb } from "./oauth-client-people";

// BI-0A724798: one shared Claude Code registration held grants for both the
// operator and an unused bootstrap account. Ending the bootstrap account's
// access must leave the operator's untouched.

type Tok = { id: string; oauthClientId: string; userId: string; revokedAt: Date | null; revokedReason: string | null; expiresAt: Date; lastUsedAt?: Date | null; consumedAt?: Date | null; createdAt: Date };

const FUTURE = new Date("2026-11-01T00:00:00Z");
const NOW = new Date("2026-10-01T12:00:00Z");

function fakeDb() {
  const access: Tok[] = [
    { id: "a1", oauthClientId: "c1", userId: "u-admin", revokedAt: null, revokedReason: null, expiresAt: FUTURE, lastUsedAt: new Date("2026-09-26T03:02:59Z"), createdAt: new Date("2026-09-26T03:00:00Z") },
    { id: "a2", oauthClientId: "c1", userId: "u-mark", revokedAt: null, revokedReason: null, expiresAt: FUTURE, lastUsedAt: new Date("2026-10-01T11:00:00Z"), createdAt: new Date("2026-10-01T10:00:00Z") },
    { id: "a3", oauthClientId: "c2", userId: "u-admin", revokedAt: null, revokedReason: null, expiresAt: FUTURE, lastUsedAt: null, createdAt: new Date("2026-09-20T00:00:00Z") },
  ];
  const refresh: Tok[] = [
    { id: "r1", oauthClientId: "c1", userId: "u-admin", revokedAt: null, revokedReason: null, expiresAt: FUTURE, consumedAt: null, createdAt: new Date("2026-09-23T00:00:00Z") },
    { id: "r2", oauthClientId: "c1", userId: "u-admin", revokedAt: null, revokedReason: null, expiresAt: FUTURE, consumedAt: null, createdAt: new Date("2026-09-26T00:00:00Z") },
    { id: "r3", oauthClientId: "c1", userId: "u-mark", revokedAt: null, revokedReason: null, expiresAt: FUTURE, consumedAt: null, createdAt: new Date("2026-10-01T10:00:00Z") },
  ];
  const users = [
    { id: "u-admin", email: "admin@dpf.local" },
    { id: "u-mark", email: "mark@example.com" },
  ];
  const clients = [{ id: "c1", oAuthClientId: "dpfoc_shared" }, { id: "c2", oAuthClientId: "dpfoc_other" }];

  const match = (t: Tok, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v === null ? (t as Record<string, unknown>)[k] == null : typeof v === "object" ? true : (t as Record<string, unknown>)[k] === v));
  const updateMany = (rows: Tok[]) => async ({ where, data }: { where: Record<string, unknown>; data: Partial<Tok> }) => {
    const hit = rows.filter((t) => match(t, where));
    hit.forEach((t) => Object.assign(t, data));
    return { count: hit.length };
  };
  const findMany = (rows: Tok[]) => async ({ where }: { where: Record<string, unknown> }) => rows.filter((t) => match(t, where));

  const db = {
    oAuthClient: { findUnique: async ({ where }: { where: { oAuthClientId: string } }) => clients.find((c) => c.oAuthClientId === where.oAuthClientId) ?? null },
    user: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => users.filter((u) => where.id.in.includes(u.id)) },
    mcpApiToken: { updateMany: updateMany(access), findMany: findMany(access) },
    oAuthRefreshToken: { updateMany: updateMany(refresh), findMany: findMany(refresh) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { db: db as unknown as ClientPeopleDb, access, refresh };
}

const OPERATOR = { userId: "u-mark", email: "mark@example.com" };

describe("revokeClientPersonGrants", () => {
  it("revokes one person's tokens under one client and leaves everyone else's live", async () => {
    const { db, access, refresh } = fakeDb();
    const result = await revokeClientPersonGrants(db, { clientId: "dpfoc_shared", userId: "u-admin", reason: "bootstrap account, misbound before BI-07D21B4A", actor: OPERATOR, now: NOW });

    expect(result).toEqual({ ok: true, data: { revokedAccessTokens: 1, revokedRefreshTokens: 2 } });
    expect(access.filter((t) => t.revokedAt).map((t) => t.id)).toEqual(["a1"]);
    expect(refresh.filter((t) => t.revokedAt).map((t) => t.id)).toEqual(["r1", "r2"]);
    // Same person, other client: untouched. Operator, same client: untouched.
    expect(access.find((t) => t.id === "a3")!.revokedAt).toBeNull();
    expect(access.find((t) => t.id === "a2")!.revokedAt).toBeNull();
    expect(refresh.find((t) => t.id === "r3")!.revokedAt).toBeNull();
  });

  it("records who revoked and why", async () => {
    const { db, refresh } = fakeDb();
    await revokeClientPersonGrants(db, { clientId: "dpfoc_shared", userId: "u-admin", reason: "unused account", actor: OPERATOR, now: NOW });
    const r1 = refresh.find((t) => t.id === "r1")!;
    expect(r1.revokedAt).toEqual(NOW);
    expect(r1.revokedReason).toBe("operator_revoked_person: unused account (by mark@example.com)");
  });

  it("refuses the operator's own grants", async () => {
    const { db, refresh } = fakeDb();
    const result = await revokeClientPersonGrants(db, { clientId: "dpfoc_shared", userId: "u-mark", reason: "x", actor: OPERATOR, now: NOW });
    expect(result.ok).toBe(false);
    expect(refresh.every((t) => t.revokedAt === null)).toBe(true);
  });

  it("refuses a missing reason and an unknown client", async () => {
    const { db } = fakeDb();
    expect((await revokeClientPersonGrants(db, { clientId: "dpfoc_shared", userId: "u-admin", reason: "  ", actor: OPERATOR, now: NOW })).ok).toBe(false);
    expect((await revokeClientPersonGrants(db, { clientId: "dpfoc_nope", userId: "u-admin", reason: "r", actor: OPERATOR, now: NOW })).ok).toBe(false);
  });
});

describe("listClientPeople", () => {
  it("lists each person holding grants under the client, marks the caller, and shows a recent revocation", async () => {
    const { db } = fakeDb();
    await revokeClientPersonGrants(db, { clientId: "dpfoc_shared", userId: "u-admin", reason: "unused account", actor: OPERATOR, now: NOW });
    const result = await listClientPeople(db, { clientId: "dpfoc_shared", actor: OPERATOR, now: NOW });
    if (!result.ok) throw new Error(result.error);

    expect(result.data).toEqual([
      expect.objectContaining({ userId: "u-mark", email: "mark@example.com", liveAccessTokens: 1, liveRefreshGrants: 1, isYou: true, lastRevocation: null }),
      expect.objectContaining({
        userId: "u-admin", email: "admin@dpf.local", liveAccessTokens: 0, liveRefreshGrants: 0, isYou: false,
        lastRevocation: { at: NOW.toISOString(), reason: "operator_revoked_person: unused account (by mark@example.com)" },
      }),
    ]);
  });
});
