import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  HubSpotApiError,
  listHubSpotContacts,
  listHubSpotForms,
  probeHubSpotPortal,
  resolveHubSpotApiBaseUrl,
} from "./client";

describe("resolveHubSpotApiBaseUrl", () => {
  const original = process.env.HUBSPOT_API_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.HUBSPOT_API_BASE_URL;
    } else {
      process.env.HUBSPOT_API_BASE_URL = original;
    }
  });

  it("defaults to the HubSpot public API host", () => {
    delete process.env.HUBSPOT_API_BASE_URL;
    expect(resolveHubSpotApiBaseUrl()).toBe("https://api.hubapi.com");
  });

  it("honors an explicit base URL override for harness tests", () => {
    process.env.HUBSPOT_API_BASE_URL = "http://integration-test-harness:8700";
    expect(resolveHubSpotApiBaseUrl()).toBe("http://integration-test-harness:8700");
  });
});

describe("probeHubSpotPortal", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns account details plus recent contacts and forms", async () => {
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
      .intercept({
        path: (value) =>
          value.startsWith("/crm/v3/objects/contacts?") &&
          value.includes("limit=5") &&
          value.includes("properties=firstname%2Clastname%2Cemail%2Clifecyclestage%2Ccreatedate"),
        method: "GET",
      })
      .reply(200, {
        results: [
          {
            id: "1",
            properties: {
              firstname: "Avery",
              lastname: "Shaw",
              email: "avery@example.com",
              lifecyclestage: "lead",
              createdate: "2026-04-24T08:00:00.000Z",
            },
          },
        ],
      });
    pool.intercept({ path: "/forms/v2/forms", method: "GET" }).reply(200, [
      {
        guid: "form-1",
        name: "Contact Sales",
        formType: "hubspot",
        createdAt: 1713945600000,
      },
    ]);

    const result = await probeHubSpotPortal({
      accessToken: "hubspot-token-123",
      dispatcher: mockAgent,
    });

    expect(result.account.portalId).toBe(123456);
    expect(result.recentContacts[0]?.properties?.email).toBe("avery@example.com");
    expect(result.recentForms[0]?.name).toBe("Contact Sales");
  });

  it("throws a redacted error on unauthorized access", async () => {
    mockAgent
      .get("https://api.hubapi.com")
      .intercept({ path: "/account-info/2026-03/details", method: "GET" })
      .reply(401, { status: "error", message: "INVALID_AUTHENTICATION" });

    await expect(
      probeHubSpotPortal({
        accessToken: "super-secret-hubspot-token",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(HubSpotApiError);

    await expect(
      probeHubSpotPortal({
        accessToken: "super-secret-hubspot-token",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-hubspot-token/);
  });

  it("lists contacts and forms with caller-supplied limits", async () => {
    const pool = mockAgent.get("https://api.hubapi.com");
    pool
      .intercept({
        path: (value) => value.startsWith("/crm/v3/objects/contacts?") && value.includes("limit=3"),
        method: "GET",
      })
      .reply(200, {
        results: [
          { id: "1", properties: { email: "one@example.com" } },
          { id: "2", properties: { email: "two@example.com" } },
        ],
      });
    pool.intercept({ path: "/forms/v2/forms", method: "GET" }).reply(200, [
      { guid: "form-1", name: "Contact Sales" },
      { guid: "form-2", name: "Newsletter" },
      { guid: "form-3", name: "Demo Request" },
      { guid: "form-4", name: "Event Signup" },
    ]);

    const contacts = await listHubSpotContacts({
      accessToken: "hubspot-token-123",
      limit: 3,
      dispatcher: mockAgent,
    });
    const forms = await listHubSpotForms({
      accessToken: "hubspot-token-123",
      limit: 2,
      dispatcher: mockAgent,
    });

    expect(contacts).toHaveLength(2);
    expect(forms).toHaveLength(2);
    expect(forms[1]?.name).toBe("Newsletter");
  });
});
