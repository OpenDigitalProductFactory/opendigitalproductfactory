import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const validPem = readFileSync(resolve(__dirname, "fixtures/valid-cert.pem"), "utf8");
const malformedPem = readFileSync(resolve(__dirname, "fixtures/malformed-cert.pem"), "utf8");
const dummyKey = `-----BEGIN PRIVATE KEY-----\nMIIBVQIBADA...(test)\n-----END PRIVATE KEY-----\n`;

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
}));

// credential-crypto's encryptJson gets called with real payloads — run it for real
// (no env key = plaintext, but the return still starts with JSON content so we can
// assert against it). No mock needed; the function is pure aside from env access.

import { connectAdp } from "./connect-action";

function baseInput() {
  return {
    clientId: "test-client",
    clientSecret: "test-secret",
    certPem: validPem,
    privateKeyPem: dummyKey,
    environment: "sandbox" as const,
  };
}

describe("connectAdp", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  it("returns ok:true and upserts a connected row on success", async () => {
    mockAgent
      .get("https://accounts.sandbox.api.adp.com")
      .intercept({ path: "/auth/oauth/v2/token", method: "POST" })
      .reply(200, { access_token: "good.token", expires_in: 3600 });

    const result = await connectAdp(baseInput(), { dispatcher: mockAgent });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ status: "connected" });
    if (result.ok) {
      expect(result.certExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("adp-workforce-now");
    expect(call.create.provider).toBe("adp");
    expect(call.create.status).toBe("connected");
    expect(call.create.certExpiresAt).toBeInstanceOf(Date);
    expect(call.create.fieldsEnc).toBeTypeOf("string");
    expect(call.create.tokenCacheEnc).toBeTypeOf("string");
  });

  it("rejects with 400 and DOES NOT persist on malformed cert", async () => {
    const result = await connectAdp(
      { ...baseInput(), certPem: malformedPem },
      { dispatcher: mockAgent },
    );

    expect(result).toEqual({
      ok: false,
      status: "error",
      error: expect.stringMatching(/certificate unreadable/i),
      statusCode: 400,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("persists status=error and returns redacted message on invalid credentials", async () => {
    mockAgent
      .get("https://accounts.sandbox.api.adp.com")
      .intercept({ path: "/auth/oauth/v2/token", method: "POST" })
      .reply(401, { error: "invalid_client" });

    const result = await connectAdp(
      { ...baseInput(), clientSecret: "wrong-secret-do-not-leak" },
      { dispatcher: mockAgent },
    );

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      statusCode: 400,
    });
    if (!result.ok) {
      expect(result.error).toMatch(/invalid client credentials/i);
      expect(result.error).not.toContain("wrong-secret-do-not-leak");
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastErrorMsg).toMatch(/invalid client credentials/i);
    expect(call.create.lastErrorMsg).not.toContain("wrong-secret-do-not-leak");
  });

  it("rejects with 400 on missing required field", async () => {
    const result = await connectAdp({ ...baseInput(), clientId: "" }, { dispatcher: mockAgent });
    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects with 400 on invalid environment", async () => {
    const result = await connectAdp(
      { ...baseInput(), environment: "staging" as unknown as "sandbox" },
      { dispatcher: mockAgent },
    );
    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
