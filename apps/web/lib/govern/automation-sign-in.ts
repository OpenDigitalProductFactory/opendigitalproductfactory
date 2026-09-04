// apps/web/lib/govern/automation-sign-in.ts
//
// BI-9369DEB5 — the platform signs its own browser in.
//
// A fully automated installation is tested by agents in the operator's absence.
// Layout, type, colour and overrun can only be judged in a real browser, and
// most pages are session-gated, so the platform needs a way to put ITS OWN
// browser behind a session without a person typing a password and without any
// credential passing through an agent prompt. This module mints a one-time,
// short-lived sign-in for a seeded automation persona; the browser opens the
// link, the route below exchanges it for the same session cookie Auth.js would
// issue, and every action the persona takes is attributed to it.
//
// Safety:
//   - Permitted only on installations whose resolved environment class is
//     `development` or `test`, or where an operator recorded an explicit grant
//     in PlatformConfig (`automation.signIn.enabled: true`). A production
//     installation refuses by default.
//   - The link carries a signed token (AUTH_SECRET, HS256), expires in ten
//     minutes, and is consumed exactly once (its `jti` is recorded).
//   - The persona is an ordinary User + Principal + EmployeeProfile with an
//     unusable random password, so it can never sign in any other way, and the
//     identity spine (`authorizePrincipalForSession`) still decides.
//   - Nothing here is a bypass: the session is issued through the platform's
//     own front door, audited under the persona, and revocable like any user.

import { randomBytes, randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { prisma } from "@dpf/db";

import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";
import { hashPassword } from "@/lib/govern/password";
import { authorizePrincipalForSession } from "@/lib/identity/authentication";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import {
  loadEnvironmentClassResolution,
  type EnvironmentClassStore,
} from "@/lib/install/environment-class";
import { isRecord } from "@/lib/shared/coerce";

export const AUTOMATION_PERSONA_EMAIL = "automation@dpf.local";
export const AUTOMATION_PERSONA_DISPLAY_NAME = "Platform automation";
export const AUTOMATION_SIGN_IN_PATH = "/api/automation/sign-in";
export const AUTOMATION_SIGN_IN_GRANT_KEY = "automation.signIn.enabled";
export const AUTOMATION_SIGN_IN_CONSUMED_KEY = "automation.signIn.consumed";
/** How long the one-time link stays valid. */
export const AUTOMATION_SIGN_IN_TOKEN_TTL_SECONDS = 10 * 60;
/** How long the resulting browser session lasts. */
export const AUTOMATION_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60;
const TOKEN_PURPOSE = "dpf.automation-sign-in/1";
const ENVIRONMENT_CLASSES_PERMITTED_BY_DEFAULT = new Set(["development", "test"]);

type PlatformConfigRow = { value: unknown };

/** The slice of Prisma this module touches, so tests can inject a fake. */
export interface AutomationSignInDb {
  user: {
    findUnique(args: unknown): Promise<
      | { id: string; email: string; isActive: boolean; isSuperuser: boolean; groups: Array<{ platformRole: { roleId: string } | null }> }
      | null
    >;
    create(args: unknown): Promise<{ id: string }>;
  };
  platformRole: { findUnique(args: unknown): Promise<{ id: string } | null> };
  employeeProfile: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
  platformConfig: {
    findUnique(args: unknown): Promise<PlatformConfigRow | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface AutomationSignInDeps {
  db?: AutomationSignInDb;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Installer-state reader for the environment class (tests inject). */
  readText?: (path: string) => Promise<string>;
  syncPrincipal?: (userId: string) => Promise<unknown>;
  authorizeSession?: (userId: string) => Promise<{ authorized: boolean; reason?: string }>;
}

function secretFor(env: Record<string, string | undefined>): Uint8Array {
  const secret = env["AUTH_SECRET"];
  if (!secret) throw new Error("AUTH_SECRET is not set; the automation sign-in cannot sign a token.");
  return new TextEncoder().encode(secret);
}

/**
 * Whether this installation may issue an automation sign-in at all: a
 * development/test class by default, anything else only with an explicit
 * operator grant recorded in PlatformConfig.
 */
export async function resolveAutomationSignInPermission(
  deps: AutomationSignInDeps = {},
): Promise<{ permitted: true; because: string } | { permitted: false; because: string }> {
  const db = deps.db ?? (prisma as unknown as AutomationSignInDb);
  const store: EnvironmentClassStore = {
    readConfig: async (key) => (await db.platformConfig.findUnique({ where: { key } }))?.value ?? null,
  };
  const resolution = await loadEnvironmentClassResolution(store, { env: deps.env, readText: deps.readText });
  const environmentClass = resolution.environmentClass;
  if (ENVIRONMENT_CLASSES_PERMITTED_BY_DEFAULT.has(environmentClass)) {
    return { permitted: true, because: `environment class ${environmentClass}` };
  }
  const grant = (await db.platformConfig.findUnique({ where: { key: AUTOMATION_SIGN_IN_GRANT_KEY } }))?.value;
  if (isRecord(grant) && grant["enabled"] === true) {
    return { permitted: true, because: `operator grant ${AUTOMATION_SIGN_IN_GRANT_KEY}` };
  }
  return {
    permitted: false,
    because: `environment class ${environmentClass} does not permit an automation sign-in; an operator can record ${AUTOMATION_SIGN_IN_GRANT_KEY}`,
  };
}

/**
 * The seeded persona: created on first use with an unusable password, its own
 * Principal and an EmployeeProfile, so session-gated operator surfaces treat it
 * like any signed-in platform manager. Idempotent.
 */
export async function ensureAutomationPersona(
  deps: AutomationSignInDeps = {},
): Promise<{ userId: string; email: string }> {
  const db = deps.db ?? (prisma as unknown as AutomationSignInDb);
  const syncPrincipal = deps.syncPrincipal ?? ((userId: string) => syncUserPrincipal(userId));
  let user = await db.user.findUnique({
    where: { email: AUTOMATION_PERSONA_EMAIL },
    select: { id: true, email: true, isActive: true, isSuperuser: true, groups: { select: { platformRole: { select: { roleId: true } } } } },
  });
  if (!user) {
    const role = await db.platformRole.findUnique({ where: { roleId: "HR-000" }, select: { id: true } });
    // 48 random bytes, hashed: nobody can ever sign this persona in by password.
    const passwordHash = await hashPassword(randomBytes(48).toString("base64url"));
    const created = await db.user.create({
      data: {
        email: AUTOMATION_PERSONA_EMAIL,
        passwordHash,
        isSuperuser: true,
        isActive: true,
        ...(role ? { groups: { create: { platformRoleId: role.id } } } : {}),
      },
      select: { id: true },
    });
    user = { id: created.id, email: AUTOMATION_PERSONA_EMAIL, isActive: true, isSuperuser: true, groups: [] };
  }
  await syncPrincipal(user.id);
  const employee = await db.employeeProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!employee) {
    await db.employeeProfile.create({
      data: {
        employeeId: `EMP-AUTO-${randomUUID().slice(0, 8).toUpperCase()}`,
        userId: user.id,
        firstName: "Platform",
        lastName: "Automation",
        displayName: AUTOMATION_PERSONA_DISPLAY_NAME,
        workEmail: AUTOMATION_PERSONA_EMAIL,
        status: "active",
      },
      select: { id: true },
    });
  }
  return { userId: user.id, email: user.email };
}

export type MintAutomationSignInResult =
  | { issued: true; url: string; path: string; expiresAt: string; persona: string; because: string }
  | { issued: false; reason: string };

/**
 * Mint a one-time sign-in link for the persona. `nextPath` is where the
 * browser lands once the session cookie is set (a path on this portal only).
 */
export async function mintAutomationSignIn(
  input: { nextPath?: string; baseUrl: string; requestedBy: string },
  deps: AutomationSignInDeps = {},
): Promise<MintAutomationSignInResult> {
  const env = deps.env ?? process.env;
  const now = deps.now?.() ?? new Date();
  const permission = await resolveAutomationSignInPermission(deps);
  if (!permission.permitted) return { issued: false, reason: permission.because };
  const nextPath = sanitizeNextPath(input.nextPath);
  const persona = await ensureAutomationPersona(deps);
  const jti = randomUUID();
  const expiresAt = new Date(now.getTime() + AUTOMATION_SIGN_IN_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({ purpose: TOKEN_PURPOSE, next: nextPath, requestedBy: input.requestedBy })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(persona.userId)
    .setJti(jti)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretFor(env));
  const path = `${AUTOMATION_SIGN_IN_PATH}?token=${encodeURIComponent(token)}`;
  console.info("[automation-sign-in] issued", { persona: persona.email, requestedBy: input.requestedBy, next: nextPath, expiresAt: expiresAt.toISOString(), because: permission.because });
  return {
    issued: true,
    url: `${input.baseUrl.replace(/\/$/, "")}${path}`,
    path,
    expiresAt: expiresAt.toISOString(),
    persona: persona.email,
    because: permission.because,
  };
}

/** The session claims the route encodes into the Auth.js cookie. */
export interface AutomationSessionClaims {
  sub: string;
  id: string;
  email: string;
  type: "admin";
  platformRole: string | null;
  isSuperuser: boolean;
  accountId: null;
  accountName: null;
  contactId: null;
}

export type ConsumeAutomationSignInResult =
  | { accepted: true; claims: AutomationSessionClaims; nextPath: string }
  | { accepted: false; reason: string };

/**
 * Exchange a one-time token for session claims. Verifies signature, purpose and
 * expiry; refuses a token that was already used; re-checks the installation
 * permission and the identity spine at exchange time, not only at mint time.
 */
export async function consumeAutomationSignIn(
  token: string,
  deps: AutomationSignInDeps = {},
): Promise<ConsumeAutomationSignInResult> {
  const env = deps.env ?? process.env;
  const db = deps.db ?? (prisma as unknown as AutomationSignInDb);
  const now = deps.now?.() ?? new Date();
  const authorizeSession = deps.authorizeSession ?? ((userId: string) => authorizePrincipalForSession(userId));

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, secretFor(env), { currentDate: now });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    return { accepted: false, reason: "token-invalid-or-expired" };
  }
  if (payload["purpose"] !== TOKEN_PURPOSE) return { accepted: false, reason: "token-wrong-purpose" };
  const userId = typeof payload["sub"] === "string" ? payload["sub"] : "";
  const jti = typeof payload["jti"] === "string" ? payload["jti"] : "";
  const exp = typeof payload["exp"] === "number" ? payload["exp"] : 0;
  if (!userId || !jti || !exp) return { accepted: false, reason: "token-malformed" };

  const permission = await resolveAutomationSignInPermission(deps);
  if (!permission.permitted) return { accepted: false, reason: permission.because };

  const consumed = await markConsumed(db, jti, exp, now);
  if (!consumed) return { accepted: false, reason: "token-already-used" };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isActive: true, isSuperuser: true, groups: { select: { platformRole: { select: { roleId: true } } } } },
  });
  if (!user || !user.isActive || user.email !== AUTOMATION_PERSONA_EMAIL) {
    return { accepted: false, reason: "persona-not-signable" };
  }
  const spine = await authorizeSession(user.id);
  if (!spine.authorized) return { accepted: false, reason: `principal-refused:${spine.reason ?? "unknown"}` };

  console.info("[automation-sign-in] consumed", { persona: user.email, requestedBy: payload["requestedBy"] ?? null, next: payload["next"] ?? "/" });
  return {
    accepted: true,
    nextPath: sanitizeNextPath(typeof payload["next"] === "string" ? payload["next"] : undefined),
    claims: {
      sub: user.id,
      id: user.id,
      email: user.email,
      type: "admin",
      platformRole: resolveWorkforcePlatformRole(user.groups),
      isSuperuser: user.isSuperuser,
      accountId: null,
      accountName: null,
      contactId: null,
    },
  };
}

/** Only a same-origin path may be the landing page; anything else lands on `/`. */
export function sanitizeNextPath(candidate: string | undefined): string {
  const value = (candidate ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

/**
 * Record the token id as used. The consumed set lives in PlatformConfig keyed by
 * jti with its expiry, pruned on every write, so it never grows past the number
 * of links issued in a ten-minute window. Returns false when already present.
 */
async function markConsumed(db: AutomationSignInDb, jti: string, exp: number, now: Date): Promise<boolean> {
  const row = await db.platformConfig.findUnique({ where: { key: AUTOMATION_SIGN_IN_CONSUMED_KEY } });
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const current: Record<string, number> = {};
  if (isRecord(row?.value)) {
    for (const [key, value] of Object.entries(row.value)) {
      if (typeof value === "number" && value > nowSeconds) current[key] = value;
    }
  }
  if (jti in current) return false;
  current[jti] = exp;
  await db.platformConfig.upsert({
    where: { key: AUTOMATION_SIGN_IN_CONSUMED_KEY },
    create: { key: AUTOMATION_SIGN_IN_CONSUMED_KEY, value: current },
    update: { value: current },
  });
  return true;
}
