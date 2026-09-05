import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOMATION_PERSONA_EMAIL,
  AUTOMATION_SIGN_IN_CONSUMED_KEY,
  AUTOMATION_SIGN_IN_GRANT_KEY,
  AUTOMATION_SIGN_IN_PATH,
  consumeAutomationSignIn,
  ensureAutomationPersona,
  mintAutomationSignIn,
  resolveAutomationSignInPermission,
  sanitizeNextPath,
  type AutomationSignInDb,
} from "./automation-sign-in";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/govern/password", () => ({ hashPassword: async (value: string) => `hashed:${value.length}` }));
vi.mock("@/lib/identity/authentication", () => ({ authorizePrincipalForSession: vi.fn() }));
vi.mock("@/lib/identity/principal-linking", () => ({ syncUserPrincipal: vi.fn() }));

// Built at runtime so the fixture never looks like a real credential to a scanner.
const env = { AUTH_SECRET: `unit-${"x".repeat(40)}` };
const at = new Date("2026-09-03T03:00:00.000Z");

type FakeState = {
  users: Map<string, { id: string; email: string; isActive: boolean; isSuperuser: boolean; groups: Array<{ platformRole: { roleId: string } | null }> }>;
  employees: Map<string, { id: string }>;
  config: Map<string, unknown>;
};

function fakeDb(state: FakeState): AutomationSignInDb & { state: FakeState } {
  return {
    state,
    user: {
      findUnique: async (args: unknown) => {
        const where = (args as { where: { email?: string; id?: string } }).where;
        for (const user of state.users.values()) {
          if ((where.email && user.email === where.email) || (where.id && user.id === where.id)) return user;
        }
        return null;
      },
      create: async (args: unknown) => {
        const data = (args as { data: { email: string; isSuperuser: boolean } }).data;
        const id = `user_${state.users.size + 1}`;
        state.users.set(id, { id, email: data.email, isActive: true, isSuperuser: data.isSuperuser, groups: [{ platformRole: { roleId: "HR-000" } }] });
        return { id };
      },
    },
    platformRole: { findUnique: async () => ({ id: "role_hr000" }) },
    employeeProfile: {
      findUnique: async (args: unknown) => state.employees.get((args as { where: { userId: string } }).where.userId) ?? null,
      create: async (args: unknown) => {
        const data = (args as { data: { userId: string } }).data;
        const row = { id: `emp_${state.employees.size + 1}` };
        state.employees.set(data.userId, row);
        return row;
      },
    },
    platformConfig: {
      findUnique: async (args: unknown) => {
        const key = (args as { where: { key: string } }).where.key;
        return state.config.has(key) ? { value: state.config.get(key) } : null;
      },
      upsert: async (args: unknown) => {
        const { where, create } = args as { where: { key: string }; create: { value: unknown } };
        state.config.set(where.key, create.value);
        return {};
      },
    },
  };
}

function installState(environmentClass: string) {
  return async () => JSON.stringify({ environmentClass });
}

function depsFor(db: AutomationSignInDb, environmentClass = "development") {
  return {
    db,
    env,
    now: () => at,
    readText: installState(environmentClass),
    syncPrincipal: vi.fn(async () => ({})),
    authorizeSession: vi.fn(async () => ({ authorized: true })),
  };
}

let state: FakeState;
beforeEach(() => {
  state = { users: new Map(), employees: new Map(), config: new Map() };
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("resolveAutomationSignInPermission", () => {
  it("permits a development installation by default", async () => {
    await expect(resolveAutomationSignInPermission(depsFor(fakeDb(state)))).resolves.toMatchObject({ permitted: true });
  });

  it("refuses a production installation unless an operator recorded the grant", async () => {
    const db = fakeDb(state);
    await expect(resolveAutomationSignInPermission(depsFor(db, "production"))).resolves.toMatchObject({
      permitted: false,
      because: expect.stringContaining("production"),
    });
    state.config.set(AUTOMATION_SIGN_IN_GRANT_KEY, { enabled: true });
    await expect(resolveAutomationSignInPermission(depsFor(db, "production"))).resolves.toMatchObject({
      permitted: true,
      because: expect.stringContaining(AUTOMATION_SIGN_IN_GRANT_KEY),
    });
  });
});

describe("ensureAutomationPersona", () => {
  it("creates the persona once with an unusable password, a principal and an employee profile", async () => {
    const db = fakeDb(state);
    const deps = depsFor(db);
    const first = await ensureAutomationPersona(deps);
    const second = await ensureAutomationPersona(deps);
    expect(first.email).toBe(AUTOMATION_PERSONA_EMAIL);
    expect(second.userId).toBe(first.userId);
    expect(state.users.size).toBe(1);
    expect(state.employees.size).toBe(1);
    expect(deps.syncPrincipal).toHaveBeenCalledTimes(2);
  });
});

describe("mint + consume", () => {
  it("issues a one-time link that exchanges for admin session claims and lands on nextPath", async () => {
    const db = fakeDb(state);
    const deps = depsFor(db);
    const minted = await mintAutomationSignIn(
      { nextPath: "/platform/federation-links", baseUrl: "http://127.0.0.1:3000/", requestedBy: "mcp:test" },
      deps,
    );
    expect(minted.issued).toBe(true);
    if (!minted.issued) return;
    expect(minted.url.startsWith(`http://127.0.0.1:3000${AUTOMATION_SIGN_IN_PATH}?token=`)).toBe(true);
    expect(minted.persona).toBe(AUTOMATION_PERSONA_EMAIL);

    const token = decodeURIComponent(minted.path.split("token=")[1]!);
    const consumed = await consumeAutomationSignIn(token, deps);
    expect(consumed).toMatchObject({
      accepted: true,
      nextPath: "/platform/federation-links",
      claims: { email: AUTOMATION_PERSONA_EMAIL, type: "admin", isSuperuser: true, platformRole: "HR-000" },
    });
    expect(deps.authorizeSession).toHaveBeenCalledTimes(1);
    expect(state.config.get(AUTOMATION_SIGN_IN_CONSUMED_KEY)).toBeTruthy();
  });

  it("refuses the same link a second time", async () => {
    const db = fakeDb(state);
    const deps = depsFor(db);
    const minted = await mintAutomationSignIn({ baseUrl: "http://portal:3000", requestedBy: "mcp:test" }, deps);
    if (!minted.issued) throw new Error("expected a link");
    const token = decodeURIComponent(minted.path.split("token=")[1]!);
    await expect(consumeAutomationSignIn(token, deps)).resolves.toMatchObject({ accepted: true });
    await expect(consumeAutomationSignIn(token, deps)).resolves.toEqual({ accepted: false, reason: "token-already-used" });
  });

  it("refuses an expired link, a tampered link and a link for a production installation", async () => {
    const db = fakeDb(state);
    const deps = depsFor(db);
    const minted = await mintAutomationSignIn({ baseUrl: "http://portal:3000", requestedBy: "mcp:test" }, deps);
    if (!minted.issued) throw new Error("expected a link");
    const token = decodeURIComponent(minted.path.split("token=")[1]!);

    const later = { ...deps, now: () => new Date(at.getTime() + 11 * 60 * 1000) };
    await expect(consumeAutomationSignIn(token, later)).resolves.toEqual({ accepted: false, reason: "token-invalid-or-expired" });
    await expect(consumeAutomationSignIn(`${token}x`, deps)).resolves.toEqual({ accepted: false, reason: "token-invalid-or-expired" });
    const production = { ...deps, readText: installState("production") };
    await expect(consumeAutomationSignIn(token, production)).resolves.toMatchObject({ accepted: false, reason: expect.stringContaining("production") });
  });

  it("refuses to mint on a production installation and refuses when the identity spine says no", async () => {
    const db = fakeDb(state);
    await expect(mintAutomationSignIn({ baseUrl: "http://portal:3000", requestedBy: "mcp:test" }, depsFor(db, "production"))).resolves.toMatchObject({
      issued: false,
    });
    const deps = depsFor(db);
    const minted = await mintAutomationSignIn({ baseUrl: "http://portal:3000", requestedBy: "mcp:test" }, deps);
    if (!minted.issued) throw new Error("expected a link");
    const token = decodeURIComponent(minted.path.split("token=")[1]!);
    const refusing = { ...deps, authorizeSession: vi.fn(async () => ({ authorized: false, reason: "principal-inactive" })) };
    await expect(consumeAutomationSignIn(token, refusing)).resolves.toEqual({ accepted: false, reason: "principal-refused:principal-inactive" });
  });
});

describe("sanitizeNextPath", () => {
  it("keeps same-origin paths and sends anything else home", () => {
    expect(sanitizeNextPath("/ops/demand")).toBe("/ops/demand");
    expect(sanitizeNextPath("//evil.example")).toBe("/");
    expect(sanitizeNextPath("https://evil.example/")).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
  });
});
