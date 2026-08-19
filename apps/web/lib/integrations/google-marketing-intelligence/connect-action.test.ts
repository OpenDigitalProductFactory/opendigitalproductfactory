import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
}));

import { connectGoogleMarketingIntelligence } from "./connect-action";

function baseInput() {
  return {
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    refreshToken: "google-refresh-token",
    ga4PropertyId: "123456",
    searchConsoleSiteUrl: "sc-domain:example.com",
  };
}

describe("connectGoogleMarketingIntelligence", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  it("returns ok:true and persists a connected Google marketing credential row", async () => {
    const tokenPool = mockAgent.get("https://oauth2.googleapis.com");
    tokenPool.intercept({ path: "/token", method: "POST" }).reply(200, {
      access_token: "google-access-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
    });

    mockAgent
      .get("https://analyticsdata.googleapis.com")
      .intercept({ path: "/v1beta/properties/123456:runReport", method: "POST" })
      .reply(200, {
        rows: [
          {
            dimensionValues: [{ value: "20260424" }],
            metricValues: [{ value: "1200" }, { value: "840" }, { value: "48" }],
          },
        ],
      });

    const encodedSite = encodeURIComponent("sc-domain:example.com");
    mockAgent
      .get("https://searchconsole.googleapis.com")
      .intercept({
        path: `/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
        method: "POST",
      })
      .reply(200, {
        rows: [{ keys: ["/managed-services", "managed it services"], clicks: 82 }],
      });

    const result = await connectGoogleMarketingIntelligence(baseInput(), {
      dispatcher: mockAgent,
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      ga4PropertyId: "123456",
      searchConsoleSiteUrl: "sc-domain:example.com",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("google-marketing-intelligence");
    expect(call.create.provider).toBe("google");
    expect(call.create.status).toBe("connected");
    expect(call.create.fieldsEnc).toBeTypeOf("string");
  });

  it("returns 400 and does not persist on invalid input", async () => {
    const result = await connectGoogleMarketingIntelligence(
      { ...baseInput(), ga4PropertyId: "" },
      { dispatcher: mockAgent },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("persists status=error with a redacted message on invalid credentials", async () => {
    mockAgent
      .get("https://oauth2.googleapis.com")
      .intercept({ path: "/token", method: "POST" })
      .reply(400, { error: "invalid_grant" });

    const result = await connectGoogleMarketingIntelligence(
      { ...baseInput(), clientSecret: "super-secret-google-client-secret" },
      { dispatcher: mockAgent },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).not.toContain("super-secret-google-client-secret");
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastErrorMsg).not.toContain("super-secret-google-client-secret");
  });
});
