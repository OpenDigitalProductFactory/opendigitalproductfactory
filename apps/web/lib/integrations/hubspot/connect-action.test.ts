import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
}));

import { connectHubSpot } from "./connect-action";

function baseInput() {
  return {
    accessToken: "pat-na1-example-token",
  };
}

describe("connectHubSpot", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  it("returns ok:true and persists a connected HubSpot credential row", async () => {
    const pool = mockAgent.get("https://api.hubapi.com");
    pool.intercept({ path: "/account-info/2026-03/details", method: "GET" }).reply(200, {
      portalId: 123456,
      accountType: "STANDARD",
      companyCurrency: "USD",
      timeZone: "US/Central",
      uiDomain: "app.hubspot.com",
      dataHostingLocation: "na1",
      additionalCurrencies: [],
      utcOffset: "-05:00",
      utcOffsetMilliseconds: -18000000,
    });
    pool
      .intercept({ path: (value) => value.startsWith("/crm/v3/objects/contacts?"), method: "GET" })
      .reply(200, { results: [] });
    pool.intercept({ path: "/forms/v2/forms", method: "GET" }).reply(200, []);

    const result = await connectHubSpot(baseInput(), { dispatcher: mockAgent });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      portalId: 123456,
      accountType: "STANDARD",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("hubspot-marketing-crm");
    expect(call.create.provider).toBe("hubspot");
    expect(call.create.status).toBe("connected");
    expect(call.create.fieldsEnc).toBeTypeOf("string");
  });

  it("returns 400 and does not persist on invalid input", async () => {
    const result = await connectHubSpot({ accessToken: " " }, { dispatcher: mockAgent });

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("persists status=error with a redacted message on invalid credentials", async () => {
    mockAgent
      .get("https://api.hubapi.com")
      .intercept({ path: "/account-info/2026-03/details", method: "GET" })
      .reply(401, { status: "error", message: "INVALID_AUTHENTICATION" });

    const result = await connectHubSpot(
      { accessToken: "super-secret-hubspot-token" },
      { dispatcher: mockAgent },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).not.toContain("super-secret-hubspot-token");
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastErrorMsg).not.toContain("super-secret-hubspot-token");
  });
});
