import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
}));

import { connectQuickBooks } from "./connect-action";

function baseInput() {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token-123",
    realmId: "9130355377388383",
    environment: "sandbox" as const,
  };
}

describe("connectQuickBooks", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  it("returns ok:true and persists a connected QuickBooks credential row", async () => {
    const oauthPool = mockAgent.get("https://oauth.platform.intuit.com");
    oauthPool
      .intercept({ path: "/oauth2/v1/tokens/bearer", method: "POST" })
      .reply(200, {
        access_token: "access-token-123",
        refresh_token: "refresh-token-456",
        token_type: "bearer",
        expires_in: 3600,
      });

    const accountingPool = mockAgent.get("https://sandbox-quickbooks.api.intuit.com");
    accountingPool
      .intercept({
        path: "/v3/company/9130355377388383/companyinfo/9130355377388383",
        method: "GET",
      })
      .reply(200, { CompanyInfo: { CompanyName: "Acme Services LLC", Country: "US" } });
    accountingPool
      .intercept({
        path: (value) =>
          value.startsWith("/v3/company/9130355377388383/query?") &&
          decodeURIComponent(value.replace(/\+/g, "%20")).includes("select * from Customer maxresults 1"),
        method: "GET",
      })
      .reply(200, { QueryResponse: { Customer: [{ Id: "42", DisplayName: "Acme Managed IT" }] } });
    accountingPool
      .intercept({
        path: (value) =>
          value.startsWith("/v3/company/9130355377388383/query?") &&
          decodeURIComponent(value.replace(/\+/g, "%20")).includes("select * from Invoice maxresults 1"),
        method: "GET",
      })
      .reply(200, { QueryResponse: { Invoice: [{ Id: "9001", DocNumber: "INV-9001" }] } });

    const result = await connectQuickBooks(baseInput(), { dispatcher: mockAgent });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      companyName: "Acme Services LLC",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("quickbooks-online-accounting");
    expect(call.create.provider).toBe("quickbooks");
    expect(call.create.status).toBe("connected");
    expect(call.create.fieldsEnc).toBeTypeOf("string");
    expect(call.create.tokenCacheEnc).toBeTypeOf("string");
  });

  it("returns 400 and does not persist on invalid input", async () => {
    const result = await connectQuickBooks({ ...baseInput(), realmId: "" }, { dispatcher: mockAgent });

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("persists status=error with a redacted message on invalid credentials", async () => {
    mockAgent
      .get("https://oauth.platform.intuit.com")
      .intercept({ path: "/oauth2/v1/tokens/bearer", method: "POST" })
      .reply(401, { error: "invalid_client" });

    const result = await connectQuickBooks(
      { ...baseInput(), clientSecret: "super-secret-do-not-leak" },
      { dispatcher: mockAgent },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).not.toContain("super-secret-do-not-leak");
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastErrorMsg).not.toContain("super-secret-do-not-leak");
  });
});
