import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  GoogleAnalyticsApiError,
  GoogleSearchConsoleApiError,
  probeGoogleMarketingIntelligence,
  resolveGoogleAnalyticsApiBaseUrl,
  resolveGoogleSearchConsoleApiBaseUrl,
} from "./clients";

describe("Google marketing API base URLs", () => {
  const originalAnalytics = process.env.GOOGLE_ANALYTICS_API_BASE_URL;
  const originalSearchConsole = process.env.GOOGLE_SEARCH_CONSOLE_API_BASE_URL;

  afterEach(() => {
    if (originalAnalytics === undefined) {
      delete process.env.GOOGLE_ANALYTICS_API_BASE_URL;
    } else {
      process.env.GOOGLE_ANALYTICS_API_BASE_URL = originalAnalytics;
    }

    if (originalSearchConsole === undefined) {
      delete process.env.GOOGLE_SEARCH_CONSOLE_API_BASE_URL;
    } else {
      process.env.GOOGLE_SEARCH_CONSOLE_API_BASE_URL = originalSearchConsole;
    }
  });

  it("defaults to Google public API hosts", () => {
    delete process.env.GOOGLE_ANALYTICS_API_BASE_URL;
    delete process.env.GOOGLE_SEARCH_CONSOLE_API_BASE_URL;

    expect(resolveGoogleAnalyticsApiBaseUrl()).toBe("https://analyticsdata.googleapis.com");
    expect(resolveGoogleSearchConsoleApiBaseUrl()).toBe("https://searchconsole.googleapis.com");
  });

  it("honors explicit harness overrides", () => {
    process.env.GOOGLE_ANALYTICS_API_BASE_URL = "http://integration-test-harness:8700/google-analytics";
    process.env.GOOGLE_SEARCH_CONSOLE_API_BASE_URL = "http://integration-test-harness:8700/search-console";

    expect(resolveGoogleAnalyticsApiBaseUrl()).toBe("http://integration-test-harness:8700/google-analytics");
    expect(resolveGoogleSearchConsoleApiBaseUrl()).toBe("http://integration-test-harness:8700/search-console");
  });
});

describe("probeGoogleMarketingIntelligence", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns GA4 summary and Search Console query/page results", async () => {
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
        rows: [
          { keys: ["/managed-services", "managed it services"], clicks: 82, impressions: 1300, ctr: 0.063, position: 7.4 },
          { keys: ["/cybersecurity", "cybersecurity support"], clicks: 49, impressions: 910, ctr: 0.053, position: 9.2 },
        ],
      });

    const result = await probeGoogleMarketingIntelligence({
      accessToken: "google-access-token",
      ga4PropertyId: "123456",
      searchConsoleSiteUrl: "sc-domain:example.com",
      dispatcher: mockAgent,
    });

    expect(result.analyticsSummary.sessions).toBe(1200);
    expect(result.analyticsSummary.totalUsers).toBe(840);
    expect(result.analyticsSummary.conversions).toBe(48);
    expect(result.searchConsoleRows[0]?.keys?.[0]).toBe("/managed-services");
  });

  it("throws a redacted analytics error on unauthorized GA4 access", async () => {
    mockAgent
      .get("https://analyticsdata.googleapis.com")
      .intercept({ path: "/v1beta/properties/123456:runReport", method: "POST" })
      .reply(403, { error: { message: "insufficientPermissions" } });

    const encodedSite = encodeURIComponent("sc-domain:example.com");
    mockAgent
      .get("https://searchconsole.googleapis.com")
      .intercept({
        path: `/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
        method: "POST",
      })
      .reply(200, {
        rows: [],
      });

    await expect(
      probeGoogleMarketingIntelligence({
        accessToken: "super-secret-google-access-token",
        ga4PropertyId: "123456",
        searchConsoleSiteUrl: "sc-domain:example.com",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(GoogleAnalyticsApiError);

    await expect(
      probeGoogleMarketingIntelligence({
        accessToken: "super-secret-google-access-token",
        ga4PropertyId: "123456",
        searchConsoleSiteUrl: "sc-domain:example.com",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-google-access-token/);
  });

  it("throws a redacted error on Search Console auth failures", async () => {
    mockAgent
      .get("https://analyticsdata.googleapis.com")
      .intercept({ path: "/v1beta/properties/123456:runReport", method: "POST" })
      .reply(200, {
        rows: [
          {
            dimensionValues: [{ value: "20260424" }],
            metricValues: [{ value: "100" }, { value: "80" }, { value: "4" }],
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
      .reply(401, { error: { message: "invalidCredentials" } });

    await expect(
      probeGoogleMarketingIntelligence({
        accessToken: "google-access-token",
        ga4PropertyId: "123456",
        searchConsoleSiteUrl: "sc-domain:example.com",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(GoogleSearchConsoleApiError);
  });
});
