import { afterEach, describe, expect, it, vi } from "vitest";

const { configureAuth } = vi.hoisted(() => ({ configureAuth: vi.fn(() => ({
  handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
})) }));
vi.mock("next-auth", () => ({ default: configureAuth }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./password", () => ({ verifyPassword: vi.fn(), hashPassword: vi.fn() }));
vi.mock("@/lib/identity/authentication", () => ({
  authorizeIdentityForSession: vi.fn(), authorizePrincipalForSession: vi.fn(),
}));
vi.mock("./social-auth", () => ({ determineSocialAuthFlow: vi.fn(), createTempToken: vi.fn() }));
vi.mock("@/lib/identity/last-seen", () => ({ recordUserSeen: vi.fn() }));

async function cookieFor(environment: string, environmentClass: string, lease: string, url = "http://localhost:3001") {
  vi.resetModules();
  configureAuth.mockClear();
  vi.stubEnv("DPF_ENVIRONMENT", environment);
  vi.stubEnv("DPF_ENVIRONMENT_CLASS", environmentClass);
  vi.stubEnv("DPF_PREVIEW_LEASE_ID", lease);
  vi.stubEnv("PUBLIC_URL", url);
  const auth = await import("./auth");
  const configuration = configureAuth.mock.calls[0] as unknown as [{ cookies: {
    sessionToken: { name: string; options: { httpOnly: boolean; sameSite: string; secure: boolean; path: string } };
  } }];
  return { name: auth.SESSION_COOKIE_NAME, secure: auth.SESSION_COOKIE_SECURE,
    configured: configuration[0].cookies.sessionToken };
}

afterEach(() => vi.unstubAllEnvs());

describe("canonical Auth.js session cookie isolation", () => {
  it("keeps the governed preview distinct from portal and sandbox sessions", async () => {
    const portal = await cookieFor("production", "production", "");
    const preview = await cookieFor("dev", "development", "NPEL-test-preview");
    const sandbox = await cookieFor("sandbox", "development", "");
    expect(preview.name).not.toBe(portal.name);
    expect(new Set([portal.name, preview.name, sandbox.name]).size).toBe(3);
    expect(preview.name).toBe("authjs.session-token.preview");
    expect(preview.configured.name).toBe(preview.name);
  });

  it.each([
    ["dev", "development", "", "authjs.session-token"],
    ["dev", "development", "   ", "authjs.session-token"],
    ["production", "production", "NPEL-stray", "authjs.session-token"],
    ["dev", "", "NPEL-stray", "authjs.session-token"],
    ["sandbox", "development", "NPEL-preview", "authjs.session-token.sandbox"],
  ])("preserves cookie identity for %s / %s / %s", async (environment, environmentClass, lease, expected) => {
    const cookie = await cookieFor(environment, environmentClass, lease);
    expect(cookie.name).toBe(expected);
    expect(cookie.configured.name).toBe(cookie.name);
  });

  it.each([["http://localhost:3001", false], ["https://localhost", true]] as const)(
    "retains cookie protection for %s", async (url, secure) => {
      const cookie = await cookieFor("dev", "development", "NPEL-test-preview", url);
      expect(cookie.secure).toBe(secure);
      expect(cookie.configured.options).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure });
    },
  );
});
