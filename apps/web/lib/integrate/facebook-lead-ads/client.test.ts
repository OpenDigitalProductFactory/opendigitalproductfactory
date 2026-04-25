import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  FacebookLeadAdsApiError,
  probeFacebookLeadAds,
  resolveFacebookGraphApiBaseUrl,
} from "./client";

describe("Facebook Lead Ads API base URL", () => {
  const originalBaseUrl = process.env.FACEBOOK_GRAPH_API_BASE_URL;

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    } else {
      process.env.FACEBOOK_GRAPH_API_BASE_URL = originalBaseUrl;
    }
  });

  it("defaults to the public Graph API host", () => {
    delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    expect(resolveFacebookGraphApiBaseUrl()).toBe("https://graph.facebook.com");
  });

  it("honors an explicit harness override", () => {
    process.env.FACEBOOK_GRAPH_API_BASE_URL = "http://integration-test-harness:8700/facebook";
    expect(resolveFacebookGraphApiBaseUrl()).toBe("http://integration-test-harness:8700/facebook");
  });
});

describe("probeFacebookLeadAds", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns page details, lead forms, and recent leads", async () => {
    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: "/123456789?fields=id%2Cname%2Ccategory&access_token=meta-token",
        method: "GET",
      })
      .reply(200, {
        id: "123456789",
        name: "Acme Managed Services",
        category: "Business Service",
      });

    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: "/123456789/leadgen_forms?fields=id%2Cname%2Cstatus%2Clocale%2Ccreated_time&access_token=meta-token&limit=5",
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "form-1",
            name: "Downtown Managed IT Consult",
            status: "ACTIVE",
            locale: "en_US",
            created_time: "2026-04-20T15:00:00+0000",
          },
        ],
      });

    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: "/form-1/leads?fields=id%2Ccreated_time%2Cad_id%2Cform_id&access_token=meta-token&limit=5",
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "lead-1",
            created_time: "2026-04-24T15:00:00+0000",
            ad_id: "ad-100",
            form_id: "form-1",
          },
        ],
      });

    const result = await probeFacebookLeadAds({
      accessToken: "meta-token",
      pageId: "123456789",
      dispatcher: mockAgent,
    });

    expect(result.page.id).toBe("123456789");
    expect(result.page.name).toBe("Acme Managed Services");
    expect(result.forms[0]?.id).toBe("form-1");
    expect(result.recentLeads[0]?.id).toBe("lead-1");
  });

  it("returns empty leads when a page has no forms yet", async () => {
    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: "/123456789?fields=id%2Cname%2Ccategory&access_token=meta-token",
        method: "GET",
      })
      .reply(200, {
        id: "123456789",
        name: "Acme Managed Services",
        category: "Business Service",
      });

    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: "/123456789/leadgen_forms?fields=id%2Cname%2Cstatus%2Clocale%2Ccreated_time&access_token=meta-token&limit=5",
        method: "GET",
      })
      .reply(200, { data: [] });

    const result = await probeFacebookLeadAds({
      accessToken: "meta-token",
      pageId: "123456789",
      dispatcher: mockAgent,
    });

    expect(result.forms).toEqual([]);
    expect(result.recentLeads).toEqual([]);
  });

  it("throws a redacted error when the token is unauthorized", async () => {
    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: "/123456789?fields=id%2Cname%2Ccategory&access_token=super-secret-meta-token",
        method: "GET",
      })
      .reply(401, {
        error: { message: "Invalid OAuth access token." },
      });

    await expect(
      probeFacebookLeadAds({
        accessToken: "super-secret-meta-token",
        pageId: "123456789",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(FacebookLeadAdsApiError);

    await expect(
      probeFacebookLeadAds({
        accessToken: "super-secret-meta-token",
        pageId: "123456789",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-meta-token/);
  });
});
