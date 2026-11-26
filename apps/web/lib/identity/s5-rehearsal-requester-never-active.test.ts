// BI-9F7192F9 phase 7 (AC-E5): the never-active invariant.
//
// Regression tests only. No issuer is edited: each issuer in the design's
// "Never-active invariant" table must refuse an enrolled S5 rehearsal
// requester with its EXISTING check. The requester carries a real bcrypt hash
// of a known password, so every refusal below is due to the inactive identity,
// never to a wrong password. Issuers do not read the enrollment record, so the
// same facts are exercised for an active and for a retired enrollment.

import { createHash, randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fn = ReturnType<typeof vi.fn>;
type Provider = { id?: string; authorize?: (credentials: Record<string, string>) => Promise<unknown> };

const h = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  nextAuthConfig: null as null | { providers: Provider[] },
  signAccessToken: vi.fn(async () => "access"),
  createRefreshToken: vi.fn(async () => "refresh"),
  rotateRefreshToken: vi.fn(async () => "rotated-refresh"),
  findClientByClientId: vi.fn(),
  quiescence: vi.fn(async () => ({ level: "normal", runId: null })),
  credentialsConsent: vi.fn(async () => null),
  recordUserSeen: vi.fn(async () => undefined),
}));

vi.mock("@dpf/db", () => ({ prisma: h.db }));
vi.mock("next-auth", () => ({
  default: (config: { providers: Provider[] }) => {
    h.nextAuthConfig = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (config: Provider) => config }));
vi.mock("next-auth/providers/google", () => ({ default: (config: object) => ({ id: "google", ...config }) }));
vi.mock("next-auth/providers/apple", () => ({ default: (config: object) => ({ id: "apple", ...config }) }));
vi.mock("@/lib/identity/last-seen", () => ({ recordUserSeen: h.recordUserSeen }));
vi.mock("@/lib/api/jwt", () => ({
  signAccessToken: h.signAccessToken, createRefreshToken: h.createRefreshToken, rotateRefreshToken: h.rotateRefreshToken,
}));
vi.mock("@/lib/auth/oauth-clients", () => ({ findClientByClientId: h.findClientByClientId, touchClient: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceConfig: h.quiescence }));
vi.mock("@/lib/auth/credentials-client-consent", () => ({ credentialsClientConsentBindingId: h.credentialsConsent }));

import { verifyPassword } from "@/lib/govern/password";
import "@/lib/govern/auth";
import { authorizePrincipalForSession } from "@/lib/identity/authentication";
import { POST as mobileLogin } from "@/app/api/v1/auth/login/route";
import { POST as mobileRefresh } from "@/app/api/v1/auth/refresh/route";
import { createBindVerifier } from "@/lib/directory/ldap/bind";
import {
  AUTOMATION_PERSONA_EMAIL,
  AUTOMATION_SIGN_IN_AUDIENCE,
  consumeAutomationSignIn,
  type AutomationSignInDb,
} from "@/lib/govern/automation-sign-in";
import { createOAuthConsentBinding, currentOAuthHuman, resolveOAuthConsent } from "@/lib/auth/oauth-identity-binding";
import {
  consumeAuthorizationCode,
  inspectOAuthExecutionAuthority,
  resolveOAuthAccessToken,
  rotateOAuthRefreshToken,
} from "@/lib/auth/oauth-tokens";
import { canonicalResourceUri } from "@/lib/auth/oauth-metadata";
import { POST as oauthToken } from "@/app/api/oauth/token/route";
import { determineSocialAuthFlow } from "@/lib/govern/social-auth";
import { issueEmployeeScopedMcpToken } from "@/lib/auth/employee-scoped-token";

const PASSWORD = "Correct-Horse-9!";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const DIGEST = createHash("sha256").update("s5-rehearsal-setup.v1:never-active").digest("hex");
const REQUESTER_ID = "req-user";
const REQUESTER_EMAIL = `rehearsal-${DIGEST.slice(0, 16)}@s5-rehearsal.invalid`;
const ORIGIN = "http://localhost:3000";
const RESOURCE = canonicalResourceUri(ORIGIN);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The enrolled requester exactly as enrollment creates it. */
function requesterUser(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUESTER_ID, email: REQUESTER_EMAIL, passwordHash: PASSWORD_HASH,
    isActive: false, isSuperuser: false,
    automationVerificationId: null, automationProfile: null, automationSlot: null, automationExpiresAt: null,
    workHandedOverAt: null, groups: [] as Array<{ platformRole: { roleId: string } | null }>,
    ...overrides,
  };
}
const requesterPrincipal = {
  id: "req-principal-row", principalId: "PRN-req", kind: "human", status: "inactive",
  aliases: [{ aliasType: "user", aliasValue: REQUESTER_ID, issuer: "" }],
};
/** An active administrator: the control proving each fixture is otherwise accepted. */
const activeAdmin = { isActive: true, isSuperuser: false, automationExpiresAt: null, groups: [{ platformRole: { roleId: "HR-000" } }] };

let user: ReturnType<typeof requesterUser>;
let principal: typeof requesterPrincipal;

function resetDb() {
  for (const key of Object.keys(h.db)) delete h.db[key];
  Object.assign(h.db, {
    $transaction: vi.fn(async (run: (db: unknown) => Promise<unknown>) => run(h.db)),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        (where.id === user.id || where.email === user.email ? user : null)),
      update: vi.fn(),
    },
    principalAlias: {
      findFirst: vi.fn(async ({ where }: { where: { aliasValue: string } }) =>
        (where.aliasValue === REQUESTER_ID ? { principal } : null)),
      findMany: vi.fn(async () => []),
    },
    principal: { findUnique: vi.fn(async () => principal) },
    platformConfig: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    customerContact: { findUnique: vi.fn(async () => null) },
    socialIdentity: { findUnique: vi.fn(async () => null) },
    apiToken: { findUnique: vi.fn(async () => ({ token: "rotated-refresh", userId: REQUESTER_ID })) },
    mcpApiToken: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(async () => ({})) },
    oAuthRefreshToken: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    oAuthAuthorizationCode: { findUnique: vi.fn(), updateMany: vi.fn() },
    agent: { findUnique: vi.fn(), findMany: vi.fn(async () => [{ id: "agent-row", agentId: "AGT-EXT-CLAUDE", displayName: "Claude" }]) },
    authorityBinding: { findUnique: vi.fn(async () => activeConsentBinding()), create: vi.fn() },
    oAuthClient: { update: vi.fn(async () => ({})) },
  });
}
const db = () => h.db as unknown as Record<string, Record<string, Fn>>;

/** A consent binding that would be honoured for an active human. */
function activeConsentBinding() {
  return {
    id: "binding-row", oauthPurpose: "consent", status: "active", oauthUserId: REQUESTER_ID,
    oauthClientId: "client-row", resourceRef: RESOURCE, appliedAgentId: "agent-row",
    appliedAgent: { id: "agent-row", agentId: "AGT-EXT-CLAUDE", status: "active", archived: false },
    grants: [{ grantKey: "dpf.read", mode: "allow" }],
  };
}

const jsonPost = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  user = requesterUser();
  principal = { ...requesterPrincipal };
  resetDb();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

it("the fixture password is valid, so every refusal below comes from the inactive identity", async () => {
  await expect(verifyPassword(PASSWORD, PASSWORD_HASH)).resolves.toEqual({ valid: true, needsRehash: false });
});

describe.each(["active", "retired"] as const)("an enrolled requester (%s enrollment) is refused by every issuer", (_lifecycle) => {
  it("workforce credentials sign-in (lib/govern/auth.ts authorize: !user.isActive)", async () => {
    const workforce = h.nextAuthConfig?.providers.find((provider) => provider.id === "workforce");
    expect(workforce?.authorize).toBeTypeOf("function");
    await expect(workforce!.authorize!({ email: REQUESTER_EMAIL, password: PASSWORD })).resolves.toBeNull();
    expect(h.recordUserSeen).not.toHaveBeenCalled();
    expect(db().user.update).not.toHaveBeenCalled();
  });

  it("the workforce principal spine refuses the inactive User, and the inactive Principal even if the User drifted active", async () => {
    await expect(authorizePrincipalForSession(REQUESTER_ID, h.db as never)).resolves.toMatchObject({ authorized: false, reason: "credential-inactive" });
    user = requesterUser({ isActive: true });
    await expect(authorizePrincipalForSession(REQUESTER_ID, h.db as never)).resolves.toMatchObject({ authorized: false, reason: "principal-inactive" });
  });

  it("mobile login (app/api/v1/auth/login: ACCOUNT_INACTIVE) issues no token", async () => {
    const response = await mobileLogin(jsonPost(`${ORIGIN}/api/v1/auth/login`, { email: REQUESTER_EMAIL, password: PASSWORD }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_INACTIVE" });
    expect(h.signAccessToken).not.toHaveBeenCalled();
    expect(h.createRefreshToken).not.toHaveBeenCalled();
  });

  it("mobile refresh (app/api/v1/auth/refresh: USER_INACTIVE) issues no access token", async () => {
    const response = await mobileRefresh(jsonPost(`${ORIGIN}/api/v1/auth/refresh`, { refreshToken: "old-refresh" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "USER_INACTIVE" });
    expect(h.signAccessToken).not.toHaveBeenCalled();
  });

  it("LDAP bind (lib/directory/ldap/bind.ts: principal.status !== active) refuses password and certificate binds before any credential", async () => {
    const verify = vi.fn(verifyPassword);
    const authorize = vi.fn(authorizePrincipalForSession);
    const bind = createBindVerifier(h.db as never, { verify, authorize });
    const dn = `uid=${requesterPrincipal.principalId},ou=people,dc=dpf`;
    await expect(bind({ bindDn: dn, password: PASSWORD } as never)).resolves.toEqual({ bound: false, reason: "invalid credentials" });
    await expect(bind({ bindDn: dn, clientCertificateSubject: requesterPrincipal.principalId } as never))
      .resolves.toEqual({ bound: false, reason: "invalid credentials" });
    expect(verify).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("automation sign-in (lib/govern/automation-sign-in.ts: !user.isActive) refuses even under the persona email", async () => {
    const env = { AUTH_SECRET: `unit-${"x".repeat(40)}` };
    const config = new Map<string, unknown>();
    const automationDb = {
      $transaction: async <T,>(body: (inner: AutomationSignInDb) => Promise<T>) => body(automationDb),
      $executeRaw: async () => 0,
      user: { findUnique: async () => ({ ...user, groups: [] }), create: vi.fn() },
      platformRole: { findUnique: vi.fn() },
      employeeProfile: { findUnique: vi.fn(), create: vi.fn() },
      platformConfig: {
        findUnique: async ({ where }: { where: { key: string } }) => (config.has(where.key) ? { value: config.get(where.key) } : null),
        upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => { config.set(where.key, create.value); return {}; },
      },
    } as unknown as AutomationSignInDb;
    const authorizeSession = vi.fn(async () => ({ authorized: true }));
    const deps = { db: automationDb, env, readText: async () => JSON.stringify({ environmentClass: "development" }), authorizeSession };
    const token = () => new SignJWT({ purpose: "dpf.automation-sign-in/1", next: "/" })
      .setProtectedHeader({ alg: "HS256" }).setSubject(REQUESTER_ID).setAudience(AUTOMATION_SIGN_IN_AUDIENCE)
      .setJti(randomUUID()).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(env.AUTH_SECRET));
    await expect(consumeAutomationSignIn(await token(), deps)).resolves.toEqual({ accepted: false, reason: "persona-not-signable" });
    user = requesterUser({ email: AUTOMATION_PERSONA_EMAIL });
    await expect(consumeAutomationSignIn(await token(), deps)).resolves.toEqual({ accepted: false, reason: "persona-not-signable" });
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("OAuth consent GET and POST (currentOAuthHuman → isCurrentUserActive) offers and binds nothing", async () => {
    await expect(currentOAuthHuman(REQUESTER_ID, h.db as never)).resolves.toBeNull();
    await expect(createOAuthConsentBinding({ userId: REQUESTER_ID, clientId: "client-row", resource: RESOURCE,
      agentId: "AGT-EXT-CLAUDE", scopes: ["dpf.read"] as never }, h.db as never)).rejects.toThrow();
    expect(db().agent.findMany).not.toHaveBeenCalled();
    expect(db().authorityBinding.create).not.toHaveBeenCalled();
  });

  it("an otherwise valid consent binding resolves only for an active human (control), never for the requester", async () => {
    const input = { bindingId: "binding-row", userId: REQUESTER_ID, clientId: "client-row", resource: RESOURCE, scopes: ["dpf.read"] };
    await expect(resolveOAuthConsent(input, h.db as never)).resolves.toBeNull();
    expect(db().agent.findMany).not.toHaveBeenCalled();
    user = requesterUser(activeAdmin);
    await expect(resolveOAuthConsent(input, h.db as never)).resolves.toEqual({ agentId: "AGT-EXT-CLAUDE", agentRecordId: "agent-row" });
  });

  it("OAuth code exchange (consumeAuthorizationCode → resolveOAuthConsent) refuses before claiming the code", async () => {
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    db().oAuthAuthorizationCode.findUnique.mockResolvedValue({
      codeHash: sha256("dpfoac_code"), expiresAt: new Date(Date.now() + 60_000), oauthClientId: "client-row",
      redirectUri: "http://127.0.0.1/cb", codeChallenge: challenge, resource: RESOURCE,
      authorityBindingId: "binding-row", userId: REQUESTER_ID, scopes: ["dpf.read"],
    });
    await expect(consumeAuthorizationCode("dpfoac_code", { oauthClientRowId: "client-row", redirectUri: "http://127.0.0.1/cb",
      codeVerifier: verifier, resource: RESOURCE }, h.db as never)).resolves.toMatchObject({ accepted: false, error: "invalid_grant" });
    expect(db().oAuthAuthorizationCode.updateMany).not.toHaveBeenCalled();
  });

  it("OAuth refresh (rotateOAuthRefreshToken → resolveOAuthConsent) refuses before consuming the token", async () => {
    db().oAuthRefreshToken.findUnique.mockResolvedValue({
      id: "refresh-row", tokenHash: sha256("dpfort_x"), oauthClientId: "client-row", resource: RESOURCE, userId: REQUESTER_ID,
      oauthFamilyKey: "family", consumedAt: null, rotatedToId: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
      authorityBindingId: "binding-row", agentId: "agent-row", scopes: ["dpf.read"],
    });
    await expect(rotateOAuthRefreshToken({ token: "dpfort_x", clientId: "client-row", clientLabel: "client", origin: ORIGIN }))
      .resolves.toMatchObject({ accepted: false, error: "invalid_grant" });
    expect(db().oAuthRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(db().mcpApiToken.create).not.toHaveBeenCalled();
  });

  it("OAuth bearer (resolveOAuthAccessToken and queued-work authority) refuses a live, correctly audienced token", async () => {
    const row = {
      id: "token-row", kind: "oauth_access", revokedAt: null, expiresAt: new Date(Date.now() + 60_000), userId: REQUESTER_ID,
      agentId: "AGT-EXT-CLAUDE", resource: RESOURCE, authorityBindingId: "binding-row", oauthClientId: "client-row",
      publicScopes: ["dpf.read"], scopes: ["dpf.read"], scope: "read", oauthFamilyKey: "family",
      oauthClient: { id: "client-row", oAuthClientId: "client", revokedAt: null, registrationKind: "public" },
    };
    db().mcpApiToken.findUnique.mockResolvedValue(row);
    await expect(resolveOAuthAccessToken("dpfoat_x", ORIGIN)).resolves.toBeNull();
    expect(db().mcpApiToken.update).not.toHaveBeenCalled();
    await expect(inspectOAuthExecutionAuthority(row as never, h.db as never)).resolves.toEqual({ allowed: false, detail: "human-unavailable" });
  });

  it("headless client_credentials (app/api/oauth/token: authorizing account not active) issues nothing", async () => {
    h.findClientByClientId.mockResolvedValue({
      rowId: "client-row", clientId: "client", clientName: "Headless", registrationKind: "credentials",
      clientSecretHash: sha256("fixture-secret"), ownerUserId: REQUESTER_ID, agentId: null, allowedScopes: ["dpf.read"],
    });
    const response = await oauthToken(new Request(`${ORIGIN}/api/oauth/token`, { method: "POST",
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: "client", client_secret: "fixture-secret" }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_client", error_description: "The authorizing account is not active." });
    expect(db().mcpApiToken.create).not.toHaveBeenCalled();
    expect(h.credentialsConsent).not.toHaveBeenCalled();
  });

  it("customer password and social sign-in resolve customer identities only, so the requester matches nothing", async () => {
    const customer = h.nextAuthConfig?.providers.find((provider) => provider.id === "customer");
    await expect(customer!.authorize!({ email: REQUESTER_EMAIL, password: PASSWORD })).resolves.toBeNull();
    await expect(determineSocialAuthFlow({ provider: "google", providerAccountId: "g-1", email: REQUESTER_EMAIL, name: "x" } as never))
      .resolves.toEqual({ flow: "onboard" });
    expect(db().user.findUnique).not.toHaveBeenCalled();
  });

  it("the employee-scoped PAT helper has no employee link to the requester, so it issues nothing", async () => {
    const issue = vi.fn();
    const result = await issueEmployeeScopedMcpToken(
      { employeeId: "EMP-ANY", agentId: "AGT-ORCH-000", name: "pat", scopes: ["dpf.read"], expiresInDays: 1 },
      { db: { employeeProfile: { findUnique: async () => null } }, issue },
    );
    expect(result).toMatchObject({ ok: false, error: "employee_not_found" });
    expect(issue).not.toHaveBeenCalled();
  });
});
