import { describe, expect, it } from "vitest";

import { endAccountAgentAccess, listAccountAgentAccess, type AccountAgentAccessDb } from "./account-agent-access";

// BI-DB506554: admin@dpf.local was handed over and still held personal tokens,
// a Codex refresh grant and a Grok credentials client of its own. The operator
// needs one view of all of it and one governed way to end it, leaving every
// other account's grants live.

type Tok = {
  id: string; userId: string; oauthClientId: string | null; revokedAt: Date | null; revokedReason: string | null;
  expiresAt: Date | null; consumedAt?: Date | null; lastUsedAt?: Date | null; createdAt: Date;
  name?: string; prefix?: string; tokenSuffix?: string; kind?: string;
};
type Client = {
  id: string; oAuthClientId: string; clientName: string; registrationKind: string; ownerUserId: string | null;
  revokedAt: Date | null; revokedReason: string | null; lastUsedAt: Date | null; createdAt: Date;
};

const NOW = new Date("2026-10-27T12:00:00Z");
const FUTURE = new Date("2026-11-27T00:00:00Z");
const PAST = new Date("2026-10-01T00:00:00Z");
const T0 = new Date("2026-10-20T00:00:00Z");

function fakeDb() {
  const users = [
    { id: "u-admin", email: "admin@dpf.local", isActive: true, workHandedOverAt: new Date("2026-10-01T02:00:00Z") },
    { id: "u-mark", email: "mark@example.com", isActive: true, workHandedOverAt: null },
  ];
  const clients: Client[] = [
    { id: "c-codex", oAuthClientId: "dpfoc_codex", clientName: "Codex", registrationKind: "dcr", ownerUserId: null, revokedAt: null, revokedReason: null, lastUsedAt: T0, createdAt: T0 },
    { id: "c-grok", oAuthClientId: "dpfoc_grok", clientName: "DPF Grok connection", registrationKind: "credentials", ownerUserId: "u-admin", revokedAt: null, revokedReason: null, lastUsedAt: NOW, createdAt: T0 },
    { id: "c-ci", oAuthClientId: "dpfoc_ci", clientName: "Mark's CI", registrationKind: "credentials", ownerUserId: "u-mark", revokedAt: null, revokedReason: null, lastUsedAt: T0, createdAt: T0 },
    { id: "c-old", oAuthClientId: "dpfoc_old", clientName: "Retired", registrationKind: "credentials", ownerUserId: "u-admin", revokedAt: PAST, revokedReason: "x", lastUsedAt: null, createdAt: T0 },
    { id: "c-pre", oAuthClientId: "dpfoc_pre", clientName: "Pinned client", registrationKind: "preregistered", ownerUserId: "u-admin", revokedAt: null, revokedReason: null, lastUsedAt: null, createdAt: T0 },
  ];
  const access: Tok[] = [
    { id: "pat1", userId: "u-admin", oauthClientId: null, revokedAt: null, revokedReason: null, expiresAt: null, lastUsedAt: T0, createdAt: T0, name: "laptop", prefix: "dpfmcp_GRV0B", tokenSuffix: "a1b2", kind: "operator" },
    { id: "pat2", userId: "u-admin", oauthClientId: null, revokedAt: null, revokedReason: null, expiresAt: PAST, createdAt: T0, name: "expired", prefix: "dpfmcp_OLD00", tokenSuffix: "zz", kind: "operator" },
    { id: "oa1", userId: "u-admin", oauthClientId: "c-codex", revokedAt: null, revokedReason: null, expiresAt: FUTURE, lastUsedAt: NOW, createdAt: T0, kind: "oauth_access" },
    { id: "oa2", userId: "u-admin", oauthClientId: "c-grok", revokedAt: null, revokedReason: null, expiresAt: FUTURE, lastUsedAt: null, createdAt: T0, kind: "oauth_access" },
    { id: "oa3", userId: "u-mark", oauthClientId: "c-codex", revokedAt: null, revokedReason: null, expiresAt: FUTURE, createdAt: T0, kind: "oauth_access" },
    { id: "pat3", userId: "u-mark", oauthClientId: null, revokedAt: null, revokedReason: null, expiresAt: null, createdAt: T0, name: "mine", prefix: "dpfmcp_MARK0", tokenSuffix: "m1", kind: "operator" },
  ];
  const refresh: Tok[] = [
    { id: "rt1", userId: "u-admin", oauthClientId: "c-codex", revokedAt: null, revokedReason: null, expiresAt: FUTURE, consumedAt: null, createdAt: T0 },
    { id: "rt2", userId: "u-admin", oauthClientId: "c-codex", revokedAt: null, revokedReason: null, expiresAt: FUTURE, consumedAt: T0, createdAt: T0 },
    { id: "rt3", userId: "u-mark", oauthClientId: "c-codex", revokedAt: null, revokedReason: null, expiresAt: FUTURE, consumedAt: null, createdAt: T0 },
  ];

  const live = (t: Tok) => !t.revokedAt && !t.consumedAt && (!t.expiresAt || t.expiresAt > NOW);
  const byUser = (rows: Tok[], where: { userId: string }) => rows.filter((t) => t.userId === where.userId);
  const db = {
    user: {
      findFirst: async ({ where }: { where: { OR: Array<{ id?: string; email?: string }> } }) =>
        users.find((u) => where.OR.some((o) => o.id === u.id || o.email === u.email)) ?? null,
    },
    mcpApiToken: {
      // The module filters live rows itself after fetching the account's rows.
      findMany: async ({ where }: { where: { userId: string } }) => byUser(access, where).filter(live),
      updateMany: async ({ where, data }: { where: { userId: string; revokedAt: null }; data: Partial<Tok> }) => {
        const hit = byUser(access, where).filter((t) => !t.revokedAt);
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      },
    },
    oAuthRefreshToken: {
      findMany: async ({ where }: { where: { userId: string } }) => byUser(refresh, where).filter(live),
      updateMany: async ({ where, data }: { where: { userId: string; revokedAt: null }; data: Partial<Tok> }) => {
        const hit = byUser(refresh, where).filter((t) => !t.revokedAt);
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      },
    },
    oAuthClient: {
      findMany: async ({ where }: { where: { id?: { in: string[] }; ownerUserId?: string; registrationKind?: string; revokedAt?: null } }) =>
        clients.filter((c) =>
          (!where.id || where.id.in.includes(c.id)) &&
          (where.ownerUserId === undefined || c.ownerUserId === where.ownerUserId) &&
          (where.registrationKind === undefined || c.registrationKind === where.registrationKind) &&
          (!("revokedAt" in where) || c.revokedAt === null)),
      updateMany: async ({ where, data }: { where: { ownerUserId: string; registrationKind: string; revokedAt: null }; data: Partial<Client> }) => {
        const hit = clients.filter((c) => c.ownerUserId === where.ownerUserId && c.registrationKind === where.registrationKind && c.revokedAt === null);
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { db: db as unknown as AccountAgentAccessDb, access, refresh, clients };
}

const OPERATOR = { userId: "u-mark", email: "mark@example.com" };

describe("listAccountAgentAccess", () => {
  it("lists one account's live tokens, grants by client, and the credentials clients it owns", async () => {
    const { db } = fakeDb();
    const result = await listAccountAgentAccess(db, { account: "admin@dpf.local", actor: OPERATOR, now: NOW });
    if (!result.ok) throw new Error(result.error);
    const view = result.data;

    expect(view.account).toMatchObject({ userId: "u-admin", email: "admin@dpf.local", isActive: true, isYou: false });
    expect(view.account.workHandedOverAt).toBe("2026-10-01T02:00:00.000Z");
    // Expired and other accounts' tokens are not "still held".
    expect(view.personalTokens.map((t) => t.prefix)).toEqual(["dpfmcp_GRV0B"]);
    expect(view.clientGrants).toEqual([
      { clientId: "dpfoc_codex", clientName: "Codex", liveAccessTokens: 1, liveRefreshGrants: 1, lastUsedAt: NOW.toISOString() },
      { clientId: "dpfoc_grok", clientName: "DPF Grok connection", liveAccessTokens: 1, liveRefreshGrants: 0, lastUsedAt: null },
    ]);
    // Only live credentials clients: the revoked one and the interactive
    // registration it merely registered are not headless access it holds.
    expect(view.ownedCredentialsClients).toEqual([
      { clientId: "dpfoc_grok", clientName: "DPF Grok connection", lastUsedAt: NOW.toISOString(), createdAt: T0.toISOString() },
    ]);
    expect(view.totals).toEqual({ personalTokens: 1, oauthAccessTokens: 2, refreshGrants: 1, credentialsClients: 1 });
  });

  it("finds the account by id as well as email", async () => {
    const { db } = fakeDb();
    const result = await listAccountAgentAccess(db, { account: "u-admin", actor: OPERATOR, now: NOW });
    expect(result.ok && result.data.account.email).toBe("admin@dpf.local");
  });

  it("says so when no account matches", async () => {
    const { db } = fakeDb();
    const result = await listAccountAgentAccess(db, { account: "nobody@example.com", actor: OPERATOR, now: NOW });
    expect(result).toEqual({ ok: false, error: "No account matches nobody@example.com." });
  });
});

describe("endAccountAgentAccess", () => {
  it("ends every token, grant and owned credentials client of one account and leaves others live", async () => {
    const { db, access, refresh, clients } = fakeDb();
    const result = await endAccountAgentAccess(db, { userId: "u-admin", reason: "Handed over; nobody uses it", actor: OPERATOR, now: NOW });

    // pat2 had expired but was never revoked: it is revoked too, like the per-person control.
    expect(result).toEqual({ ok: true, data: { revokedAccessTokens: 4, revokedRefreshTokens: 2, revokedCredentialsClients: 1 } });
    expect(access.filter((t) => t.userId === "u-mark").every((t) => t.revokedAt === null)).toBe(true);
    expect(refresh.find((t) => t.id === "rt3")!.revokedAt).toBeNull();
    expect(clients.find((c) => c.id === "c-ci")!.revokedAt).toBeNull();
    // An interactive registration it created stays: other people may hold grants under it.
    expect(clients.find((c) => c.id === "c-pre")!.revokedAt).toBeNull();
    expect(clients.find((c) => c.id === "c-grok")!.revokedAt).toEqual(NOW);
  });

  it("records who ended the access and why on every row it touched", async () => {
    const { db, access, refresh, clients } = fakeDb();
    await endAccountAgentAccess(db, { userId: "u-admin", reason: "Handed over", actor: OPERATOR, now: NOW });
    const expected = "operator_revoked_person: Handed over (by mark@example.com)";
    expect(access.find((t) => t.id === "pat1")!.revokedReason).toBe(expected);
    expect(refresh.find((t) => t.id === "rt1")!.revokedReason).toBe(expected);
    expect(clients.find((c) => c.id === "c-grok")!.revokedReason).toBe(expected);
  });

  it("refuses the operator's own account", async () => {
    const { db, access } = fakeDb();
    const result = await endAccountAgentAccess(db, { userId: "u-mark", reason: "x", actor: OPERATOR, now: NOW });
    expect(result.ok).toBe(false);
    expect(access.every((t) => t.revokedAt === null)).toBe(true);
  });

  it("refuses without a reason", async () => {
    const { db, access } = fakeDb();
    const result = await endAccountAgentAccess(db, { userId: "u-admin", reason: "  ", actor: OPERATOR, now: NOW });
    expect(result).toEqual({ ok: false, error: "Say why this person's access is ending." });
    expect(access.every((t) => t.revokedAt === null)).toBe(true);
  });
});
