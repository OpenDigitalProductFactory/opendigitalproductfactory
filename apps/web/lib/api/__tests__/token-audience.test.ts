// BI-7B4B5F5D — tokens signed with AUTH_SECRET must not cross surfaces.
//
// Four token kinds are HS256-signed with the same AUTH_SECRET: mobile access
// tokens (lib/api/jwt.ts), MCP session tokens (lib/mcp/session-token.ts),
// automation sign-in links (lib/govern/automation-sign-in.ts) and social-auth
// temp tokens (lib/govern/social-auth.ts). A verifier that checks only the
// signature accepts all four. These tests pin that each verifier accepts only
// its own kind, and that mobile sign-in keeps working once tokens carry an
// audience.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    apiToken: {},
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("../../auth.js", () => ({ auth: vi.fn() }));
vi.mock("../../permissions.js", () => ({ getGrantedCapabilities: vi.fn(() => ["view_portfolio"]) }));
vi.mock("../../identity/load-effective-auth-context.js", () => ({
  loadEffectiveAuthContext: vi.fn(async () => ({})),
}));

import { SignJWT, decodeJwt } from "jose";
import { prisma } from "@dpf/db";
import { signAccessToken, verifyAccessToken } from "../jwt";
import { authenticateRequest } from "../auth-middleware";
import { createMcpSessionToken, verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { createTempToken, verifyTempToken } from "@/lib/govern/social-auth";

const SECRET = "token-audience-test-secret-long-enough-for-hs256";

const mobileUser = { sub: "user-1", email: "user@example.com", platformRole: "HR-000", isSuperuser: false };

function bearer(token: string): Request {
  return new Request("https://portal.example/api/v1/workspace/dashboard", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function mintMcpSessionToken(): Promise<string> {
  // A read-only, single-scope token: exactly what run_tool_script writes into
  // the sandbox where model-authored code runs (lib/tak/tool-script.ts).
  return createMcpSessionToken({ userId: "user-1", agentId: "agent-1", scopes: ["backlog_read"], capability: "read" });
}

function mintAutomationSignInToken(): Promise<string> {
  // Same claims and signing as mintAutomationSignIn (automation-sign-in.ts).
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose: "dpf.automation-sign-in/1", next: "/", requestedBy: "test" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("automation-persona")
    .setJti("jti-1")
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(new TextEncoder().encode(SECRET));
}

function mintLegacyMobileAccessToken(): Promise<string> {
  // The shape signAccessToken produced before BI-7B4B5F5D: no iss, no aud.
  return new SignJWT({ email: mobileUser.email, platformRole: mobileUser.platformRole, isSuperuser: false })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(mobileUser.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(SECRET));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = SECRET;
  (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "user-1",
    email: mobileUser.email,
    isActive: true,
    isSuperuser: false,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  });
});

describe("AC-NO-CROSS-SURFACE: the mobile API verifier accepts only mobile access tokens", () => {
  it("refuses an MCP session token", async () => {
    await expect(verifyAccessToken(await mintMcpSessionToken())).rejects.toThrow();
  });

  it("refuses an MCP session token at the request boundary, before any user lookup", async () => {
    await expect(authenticateRequest(bearer(await mintMcpSessionToken()))).rejects.toMatchObject({
      code: "INVALID_TOKEN",
      status: 401,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuses an automation sign-in link token", async () => {
    await expect(verifyAccessToken(await mintAutomationSignInToken())).rejects.toThrow();
  });

  it("refuses a social-auth temp token", async () => {
    const temp = await createTempToken({ provider: "google", providerAccountId: "g-1", email: "c@example.com", name: null });
    await expect(verifyAccessToken(temp)).rejects.toThrow();
  });

  it("refuses a pre-cutover mobile token without an audience; the client refreshes on 401", async () => {
    await expect(verifyAccessToken(await mintLegacyMobileAccessToken())).rejects.toThrow();
  });
});

describe("AC-NO-CROSS-SURFACE: other verifiers refuse a mobile access token", () => {
  it("the MCP session verifier refuses a mobile access token", async () => {
    await expect(verifyMcpSessionToken(await signAccessToken(mobileUser))).resolves.toBeNull();
  });

  it("the social-auth temp-token verifier refuses a mobile access token", async () => {
    await expect(verifyTempToken(await signAccessToken(mobileUser))).rejects.toThrow();
  });

  it("the social-auth temp-token verifier refuses an MCP session token", async () => {
    await expect(verifyTempToken(await mintMcpSessionToken())).rejects.toThrow();
  });
});

describe("AC-MOBILE-STILL-WORKS: mobile access tokens minted now are accepted", () => {
  it("carries a mobile issuer and audience distinct from the MCP ones", async () => {
    const claims = decodeJwt(await signAccessToken(mobileUser));
    expect(typeof claims.iss).toBe("string");
    expect(claims.iss).not.toBe("dpf-mcp-internal");
    expect(typeof claims.aud).toBe("string");
    expect(claims.aud).not.toBe("dpf-mcp-server");
  });

  it("verifies and keeps its claims", async () => {
    await expect(verifyAccessToken(await signAccessToken(mobileUser))).resolves.toMatchObject({
      sub: "user-1",
      email: mobileUser.email,
      platformRole: "HR-000",
      isSuperuser: false,
    });
  });

  it("authenticates at the request boundary", async () => {
    const result = await authenticateRequest(bearer(await signAccessToken(mobileUser)));
    expect(result.user.id).toBe("user-1");
    expect(prisma.user.findUnique).toHaveBeenCalledOnce();
  });
});
