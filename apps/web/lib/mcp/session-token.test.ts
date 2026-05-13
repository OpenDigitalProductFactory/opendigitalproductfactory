import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
