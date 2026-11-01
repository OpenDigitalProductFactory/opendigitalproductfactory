import { afterEach, describe, expect, it, vi } from "vitest";
import { Auth } from "@auth/core";
import { encode } from "next-auth/jwt";

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
    sessionToken: { name: string; options: { httpOnly: boolean; sameSite: "lax"; secure: boolean; path: string } };
  } }];
  return { name: auth.SESSION_COOKIE_NAME, secure: auth.SESSION_COOKIE_SECURE,
    configured: configuration[0].cookies.sessionToken };
}

afterEach(() => vi.unstubAllEnvs());

describe("canonical Auth.js session cookie isolation", () => {
  const secret = "test-only-session-secret-".repeat(2);
  const sessionResponse = (cookie: Awaited<ReturnType<typeof cookieFor>>, header: string, url = "https://localhost") => Auth(
    new Request(`${url}/api/auth/session`, { headers: { cookie: header } }),
    { secret, trustHost: true, basePath: "/api/auth", providers: [], session: { strategy: "jwt" },
      cookies: { sessionToken: cookie.configured }, logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } },
  );

  it("does not let a real portal session read delete the preview as a cookie chunk", async () => {
    const portal = await cookieFor("production", "production", "", "https://localhost");
    const preview = await cookieFor("dev", "development", "NPEL-test-preview");
    const token = await encode({ secret, salt: preview.name, token: { sub: "preview-fixture", name: "Preview fixture" } });
    const response = await sessionResponse(portal, `${preview.name}=${token}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(response.headers.getSetCookie().map(value => value.split("=")[0])).not.toContain(preview.name);
  });

  it("keeps a valid portal JWT readable when a preview JWT is present on localhost", async () => {
    const portal = await cookieFor("production", "production", "", "https://localhost");
    const preview = await cookieFor("dev", "development", "NPEL-test-preview");
    const portalToken = await encode({ secret, salt: portal.name, token: { sub: "portal-fixture", name: "Portal fixture" } });
    const previewToken = await encode({ secret, salt: preview.name, token: { sub: "preview-fixture", name: "Preview fixture" } });
    const response = await sessionResponse(portal, `${portal.name}=${portalToken}; ${preview.name}=${previewToken}`);
    expect(await response.json()).toMatchObject({ user: { name: "Portal fixture" } });
    expect(response.headers.getSetCookie().map(value => value.split("=")[0])).not.toContain(preview.name);
  });

  it("retains real Auth.js preview chunking without borrowing the portal token", async () => {
    const portal = await cookieFor("production", "production", "", "https://localhost");
    const preview = await cookieFor("dev", "development", "NPEL-test-preview");
    const token = await encode({ secret, salt: preview.name, token: { sub: "preview-fixture", name: "Preview fixture" } });
    const split = Math.floor(token.length / 2);
    const response = await sessionResponse(preview,
      `${portal.name}=unrelated-portal-fixture; ${preview.name}.0=${token.slice(0, split)}; ${preview.name}.1=${token.slice(split)}`,
      "http://localhost:3001");
    expect(await response.json()).toMatchObject({ user: { name: "Preview fixture" } });
    expect(response.headers.getSetCookie().map(value => value.split("=")[0])).not.toContain(portal.name);
  });

  it("keeps the governed preview distinct from portal and sandbox sessions", async () => {
    const portal = await cookieFor("production", "production", "");
    const preview = await cookieFor("dev", "development", "NPEL-test-preview");
    const sandbox = await cookieFor("sandbox", "development", "");
    expect(preview.name).not.toBe(portal.name);
    expect(new Set([portal.name, preview.name, sandbox.name]).size).toBe(3);
    expect(preview.name).toBe("dpf-preview.authjs.session-token");
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
