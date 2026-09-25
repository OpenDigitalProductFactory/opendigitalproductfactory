import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/lib/govern/auth";

const consumeAutomationSignIn = vi.fn();

vi.mock("@/lib/govern/automation-sign-in", () => ({
  AUTOMATION_SESSION_MAX_AGE_SECONDS: 3600,
  consumeAutomationSignIn: (...args: unknown[]) => consumeAutomationSignIn(...args),
}));
vi.mock("@/lib/portal-url", () => ({ getPortalUrl: async () => "http://192.168.0.200:3000" }));

const { GET } = await import("./route");

// Built at runtime so the fixture never looks like a real credential to a scanner.
const SECRET = `unit-${"x".repeat(40)}`;
const PERSONA_USER_ID = "user_automation_persona";

async function sessionCookieFor(sub: string): Promise<string> {
  return encode({ token: { sub, id: sub }, secret: SECRET, salt: SESSION_COOKIE_NAME, maxAge: 3600 });
}

function requestWith(cookie?: string): NextRequest {
  const request = new NextRequest("http://192.168.0.200:3000/api/automation/sign-in?token=one-time");
  if (cookie) request.cookies.set(SESSION_COOKIE_NAME, cookie);
  return request;
}

describe("GET /api/automation/sign-in", () => {
  beforeEach(() => {
    consumeAutomationSignIn.mockReset();
    process.env.AUTH_SECRET = SECRET;
  });

  // BI-D146D071. The platform's own browser pane fetched the one-time link
  // twice: the first request signed the persona in, the second was refused and
  // the raw UNAUTHORIZED JSON is what the operator saw, even though the session
  // was live and the destination one click away.
  it("redirects instead of refusing when the caller already holds the session that token created", async () => {
    consumeAutomationSignIn.mockResolvedValue({
      accepted: false,
      reason: "token-already-used",
      replay: { sub: PERSONA_USER_ID, nextPath: "/platform/federation-links" },
    });

    const response = await GET(requestWith(await sessionCookieFor(PERSONA_USER_ID)));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://192.168.0.200:3000/platform/federation-links");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    // The replay never re-issues a session; the browser already has one.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("still refuses a reused link presented without that session", async () => {
    consumeAutomationSignIn.mockResolvedValue({
      accepted: false,
      reason: "token-already-used",
      replay: { sub: PERSONA_USER_ID, nextPath: "/platform/federation-links" },
    });

    const response = await GET(requestWith());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED", message: "token-already-used" });
  });

  it("still refuses a reused link presented with someone else's session", async () => {
    consumeAutomationSignIn.mockResolvedValue({
      accepted: false,
      reason: "token-already-used",
      replay: { sub: PERSONA_USER_ID, nextPath: "/platform/federation-links" },
    });

    const response = await GET(requestWith(await sessionCookieFor("user_somebody_else")));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED", message: "token-already-used" });
  });

  it("refuses an environment-class denial with 403 and never replays it", async () => {
    consumeAutomationSignIn.mockResolvedValue({
      accepted: false,
      reason: "environment class production does not permit an automation sign-in",
    });

    const response = await GET(requestWith(await sessionCookieFor(PERSONA_USER_ID)));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sets the session cookie and redirects on a first, accepted exchange", async () => {
    consumeAutomationSignIn.mockResolvedValue({
      accepted: true,
      nextPath: "/platform/federation-links",
      claims: { sub: PERSONA_USER_ID, id: PERSONA_USER_ID, email: "automation@example.test", type: "admin", platformRole: null, isSuperuser: true, accountId: null, accountName: null, contactId: null },
    });

    const response = await GET(requestWith());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://192.168.0.200:3000/platform/federation-links");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
  });
});
