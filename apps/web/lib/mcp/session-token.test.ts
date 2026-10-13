import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

import {
  createMcpSessionToken,
  verifyMcpSessionToken,
  MCP_SESSION_TTL_SECONDS,
} from "./session-token";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;
const TEST_SECRET = "test-secret-key-that-is-long-enough-for-hmac-sha256-signing";

beforeEach(() => {
  process.env.AUTH_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = ORIGINAL_SECRET;
  }
});

describe("createMcpSessionToken", () => {
  it("rejects missing userId", async () => {
    await expect(
      createMcpSessionToken({
        userId: "",
        scopes: ["backlog_read"],
        capability: "read",
      }),
    ).rejects.toThrow(/userId is required/);
  });

  it("rejects empty scopes", async () => {
    await expect(
      createMcpSessionToken({
        userId: "user-1",
        scopes: [],
        capability: "read",
      }),
    ).rejects.toThrow(/at least one scope/);
  });

  it("rejects invalid capability", async () => {
    await expect(
      createMcpSessionToken({
        userId: "user-1",
        scopes: ["backlog_read"],
        // @ts-expect-error invalid value forced for the negative test
        capability: "admin",
      }),
    ).rejects.toThrow(/capability must be/);
  });

  it("throws when AUTH_SECRET is not set", async () => {
    delete process.env.AUTH_SECRET;
    await expect(
      createMcpSessionToken({
        userId: "user-1",
        scopes: ["backlog_read"],
        capability: "read",
      }),
    ).rejects.toThrow(/AUTH_SECRET/);
  });

  it("produces a verifiable JWT round-trip", async () => {
    const token = await createMcpSessionToken({
      userId: "user-1",
      agentId: "build-specialist",
      threadId: "thread-abc",
      routeContext: "/build",
      scopes: ["backlog_read", "build_plan_write"],
      capability: "write",
    });

    const verified = await verifyMcpSessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe("user-1");
    expect(verified!.taskRunId).toBeNull();
    expect(verified!.agentId).toBe("build-specialist");
    expect(verified!.threadId).toBe("thread-abc");
    expect(verified!.routeContext).toBe("/build");
    expect(verified!.scopes).toEqual(["backlog_read", "build_plan_write"]);
    expect(verified!.capability).toBe("write");
  });

  it("normalizes optional fields to null when omitted", async () => {
    const token = await createMcpSessionToken({
      userId: "user-1",
      scopes: ["backlog_read"],
      capability: "read",
    });

    const verified = await verifyMcpSessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.agentId).toBeNull();
    expect(verified!.threadId).toBeNull();
    expect(verified!.routeContext).toBeNull();
  });
});

describe("verifyMcpSessionToken", () => {
  it("returns null for a malformed token", async () => {
    const result = await verifyMcpSessionToken("not-a-jwt");
    expect(result).toBeNull();
  });

  it("returns null when token signature does not match the current secret", async () => {
    process.env.AUTH_SECRET = "old-secret-that-is-long-enough-for-hmac-sha256";
    const token = await createMcpSessionToken({
      userId: "user-1",
      scopes: ["backlog_read"],
      capability: "read",
    });

    process.env.AUTH_SECRET = "rotated-secret-also-long-enough-for-hmac-sha256";
    const result = await verifyMcpSessionToken(token);
    expect(result).toBeNull();
  });

  it("returns null when token has expired", async () => {
    // Sign a token with iat in the past beyond TTL
    const pastIssued = Math.floor(Date.now() / 1000) - (MCP_SESSION_TTL_SECONDS + 60);
    const expiredToken = await new SignJWT({
      scopes: ["backlog_read"],
      capability: "read",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer("dpf-mcp-internal")
      .setAudience("dpf-mcp-server")
      .setIssuedAt(pastIssued)
      .setExpirationTime(pastIssued + 60) // expired 60s after iat, well in the past
      .sign(new TextEncoder().encode(TEST_SECRET));

    const result = await verifyMcpSessionToken(expiredToken);
    expect(result).toBeNull();
  });

  it("returns null when token has wrong issuer", async () => {
    const wrongIssuer = await new SignJWT({
      scopes: ["backlog_read"],
      capability: "read",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer("not-dpf-mcp-internal")
      .setAudience("dpf-mcp-server")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const result = await verifyMcpSessionToken(wrongIssuer);
    expect(result).toBeNull();
  });

  it("returns null when token has wrong audience", async () => {
    const wrongAudience = await new SignJWT({
      scopes: ["backlog_read"],
      capability: "read",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer("dpf-mcp-internal")
      .setAudience("dpf-mobile-api") // different audience — should be rejected
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const result = await verifyMcpSessionToken(wrongAudience);
    expect(result).toBeNull();
  });

  it("returns null when capability claim is invalid", async () => {
    const badCap = await new SignJWT({
      scopes: ["backlog_read"],
      capability: "admin", // not read|write
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer("dpf-mcp-internal")
      .setAudience("dpf-mcp-server")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const result = await verifyMcpSessionToken(badCap);
    expect(result).toBeNull();
  });

  it("returns null when scopes claim is missing", async () => {
    const noScopes = await new SignJWT({
      capability: "read",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer("dpf-mcp-internal")
      .setAudience("dpf-mcp-server")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const result = await verifyMcpSessionToken(noScopes);
    expect(result).toBeNull();
  });
});

describe("taskRunId round-trip (BI-B949993E)", () => {
  it("carries the governed TaskRun id so the route can resolve its review binding", async () => {
    const token = await createMcpSessionToken({
      userId: "user-1",
      agentId: "AGT-WS-REVIEW",
      threadId: "thread-abc",
      routeContext: "/build",
      taskRunId: "TR-MCP-abc-123",
      scopes: ["backlog_read", "initiative_design_review"],
      capability: "write",
    });
    const verified = await verifyMcpSessionToken(token);
    expect(verified?.taskRunId).toBe("TR-MCP-abc-123");
  });

  it("reads a non-string taskRunId claim as absent", async () => {
    const token = await new SignJWT({ scopes: ["backlog_read"], capability: "read", taskRunId: 42 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer("dpf-mcp-internal")
      .setAudience("dpf-mcp-server")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(TEST_SECRET));
    const verified = await verifyMcpSessionToken(token);
    expect(verified?.taskRunId).toBeNull();
  });
});

// BI-44D9B67B: the verifier enforced only `exp` (and only when present), so a
// token signed with AUTH_SECRET could claim any lifetime. These pin the bound
// the minter already implies: no token lives longer than MCP_SESSION_TTL_SECONDS
// (plus a small clock-skew allowance), and `iat` must be present and not in the future.
describe("lifetime and iat bounds (BI-44D9B67B)", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  async function signForged(claims: { iat?: number; exp?: number }): Promise<string> {
    let jwt = new SignJWT({ scopes: ["backlog_read", "build_plan_write"], capability: "write" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer("dpf-mcp-internal")
      .setAudience("dpf-mcp-server");
    if (claims.iat !== undefined) jwt = jwt.setIssuedAt(claims.iat);
    if (claims.exp !== undefined) jwt = jwt.setExpirationTime(claims.exp);
    return jwt.sign(new TextEncoder().encode(TEST_SECRET));
  }

  describe("AC-MCP-TOKEN-MAX-LIFETIME", () => {
    it("refuses a freshly issued write token that claims a 365-day lifetime", async () => {
      const iat = nowSeconds();
      const token = await signForged({ iat, exp: iat + 365 * 24 * 60 * 60 });
      expect(await verifyMcpSessionToken(token)).toBeNull();
    });

    it("refuses a token issued a day ago whose exp is still in the future", async () => {
      const iat = nowSeconds() - 24 * 60 * 60;
      const token = await signForged({ iat, exp: nowSeconds() + 60 });
      expect(await verifyMcpSessionToken(token)).toBeNull();
    });

    it("refuses a token with no exp claim", async () => {
      const token = await signForged({ iat: nowSeconds() });
      expect(await verifyMcpSessionToken(token)).toBeNull();
    });

    it("accepts a token carrying exactly the minted TTL", async () => {
      const iat = nowSeconds();
      const token = await signForged({ iat, exp: iat + MCP_SESSION_TTL_SECONDS });
      const verified = await verifyMcpSessionToken(token);
      expect(verified?.capability).toBe("write");
    });

    it("the minter issues exactly MCP_SESSION_TTL_SECONDS, so the cap and the mint share one source", async () => {
      const token = await createMcpSessionToken({ userId: "user-1", scopes: ["backlog_read"], capability: "read" });
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      expect(typeof claims.iat).toBe("number");
      expect(claims.exp - claims.iat).toBe(MCP_SESSION_TTL_SECONDS);
      expect(await verifyMcpSessionToken(token)).not.toBeNull();
    });
  });

  describe("AC-MCP-TOKEN-IAT", () => {
    it("refuses a token whose iat is an hour in the future", async () => {
      const iat = nowSeconds() + 60 * 60;
      const token = await signForged({ iat, exp: iat + MCP_SESSION_TTL_SECONDS });
      expect(await verifyMcpSessionToken(token)).toBeNull();
    });

    it("accepts a token whose iat is a few seconds ahead (within clock skew)", async () => {
      const iat = nowSeconds() + 5;
      const token = await signForged({ iat, exp: iat + MCP_SESSION_TTL_SECONDS });
      expect(await verifyMcpSessionToken(token)).not.toBeNull();
    });

    it("refuses a token with no iat claim (fail closed: the only minter always sets it)", async () => {
      const token = await signForged({ exp: nowSeconds() + MCP_SESSION_TTL_SECONDS });
      expect(await verifyMcpSessionToken(token)).toBeNull();
    });
  });

  it("logs the refusal reason on the server, never the token or its claims", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const now = nowSeconds();
      const cases: Array<[string, { iat?: number; exp?: number }]> = [
        ["lifetime_exceeds_cap", { iat: now, exp: now + 365 * 24 * 60 * 60 }],
        ["lifetime_exceeds_cap", { iat: now - 24 * 60 * 60, exp: now + 60 }],
        ["iat_in_future", { iat: now + 60 * 60, exp: now + 60 * 60 + MCP_SESSION_TTL_SECONDS }],
        ["missing_iat", { exp: now + MCP_SESSION_TTL_SECONDS }],
        ["missing_exp", { iat: now }],
      ];
      for (const [reason, claims] of cases) {
        warn.mockClear();
        const token = await signForged(claims);
        expect(await verifyMcpSessionToken(token)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        const line = String(warn.mock.calls[0][0]);
        expect(line).toContain(`refused: ${reason}`);
        expect(line).not.toContain(token);
        expect(line).not.toContain(token.split(".")[1]);
        expect(line).not.toContain("user-1");
      }
    } finally {
      warn.mockRestore();
    }
  });
});
