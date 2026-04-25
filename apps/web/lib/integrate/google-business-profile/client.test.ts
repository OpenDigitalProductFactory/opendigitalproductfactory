import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  GoogleBusinessProfileApiError,
  probeGoogleBusinessProfile,
  resolveGoogleBusinessAccountManagementApiBaseUrl,
  resolveGoogleBusinessInformationApiBaseUrl,
  resolveGoogleBusinessProfileApiBaseUrl,
} from "./client";

describe("Google Business Profile API base URLs", () => {
  const originalAccountBaseUrl = process.env.GOOGLE_BUSINESS_ACCOUNT_MANAGEMENT_API_BASE_URL;
  const originalInformationBaseUrl = process.env.GOOGLE_BUSINESS_INFORMATION_API_BASE_URL;
  const originalProfileBaseUrl = process.env.GOOGLE_BUSINESS_PROFILE_API_BASE_URL;

  afterEach(() => {
    if (originalAccountBaseUrl === undefined) {
      delete process.env.GOOGLE_BUSINESS_ACCOUNT_MANAGEMENT_API_BASE_URL;
    } else {
      process.env.GOOGLE_BUSINESS_ACCOUNT_MANAGEMENT_API_BASE_URL = originalAccountBaseUrl;
    }

    if (originalInformationBaseUrl === undefined) {
      delete process.env.GOOGLE_BUSINESS_INFORMATION_API_BASE_URL;
    } else {
      process.env.GOOGLE_BUSINESS_INFORMATION_API_BASE_URL = originalInformationBaseUrl;
    }

    if (originalProfileBaseUrl === undefined) {
      delete process.env.GOOGLE_BUSINESS_PROFILE_API_BASE_URL;
    } else {
      process.env.GOOGLE_BUSINESS_PROFILE_API_BASE_URL = originalProfileBaseUrl;
    }
  });

  it("defaults to the public Google Business Profile API hosts", () => {
    delete process.env.GOOGLE_BUSINESS_ACCOUNT_MANAGEMENT_API_BASE_URL;
    delete process.env.GOOGLE_BUSINESS_INFORMATION_API_BASE_URL;
    delete process.env.GOOGLE_BUSINESS_PROFILE_API_BASE_URL;

    expect(resolveGoogleBusinessAccountManagementApiBaseUrl()).toBe(
      "https://mybusinessaccountmanagement.googleapis.com",
    );
    expect(resolveGoogleBusinessInformationApiBaseUrl()).toBe(
      "https://mybusinessbusinessinformation.googleapis.com",
    );
    expect(resolveGoogleBusinessProfileApiBaseUrl()).toBe("https://mybusiness.googleapis.com");
  });

  it("honors explicit harness overrides", () => {
    process.env.GOOGLE_BUSINESS_ACCOUNT_MANAGEMENT_API_BASE_URL =
      "http://integration-test-harness:8700/google-business-account";
    process.env.GOOGLE_BUSINESS_INFORMATION_API_BASE_URL =
      "http://integration-test-harness:8700/google-business-information";
    process.env.GOOGLE_BUSINESS_PROFILE_API_BASE_URL =
      "http://integration-test-harness:8700/google-business-profile";

    expect(resolveGoogleBusinessAccountManagementApiBaseUrl()).toBe(
      "http://integration-test-harness:8700/google-business-account",
    );
    expect(resolveGoogleBusinessInformationApiBaseUrl()).toBe(
      "http://integration-test-harness:8700/google-business-information",
    );
    expect(resolveGoogleBusinessProfileApiBaseUrl()).toBe(
      "http://integration-test-harness:8700/google-business-profile",
    );
  });
});

describe("probeGoogleBusinessProfile", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns account, location, and recent review data", async () => {
    mockAgent
      .get("https://mybusinessaccountmanagement.googleapis.com")
      .intercept({
        path: "/v1/accounts",
        method: "GET",
      })
      .reply(200, {
        accounts: [
          {
            name: "accounts/123",
            accountName: "Acme Managed Services",
            type: "PERSONAL",
          },
        ],
      });

    mockAgent
      .get("https://mybusinessbusinessinformation.googleapis.com")
      .intercept({
        path:
          "/v1/locations/456?readMask=name%2Ctitle%2CstorefrontAddress%2CwebsiteUri%2CphoneNumbers%2CregularHours%2Cmetadata",
        method: "GET",
      })
      .reply(200, {
        name: "locations/456",
        title: "Acme MSP - Austin",
        websiteUri: "https://acme.example.com",
        storefrontAddress: {
          locality: "Austin",
          administrativeArea: "TX",
        },
      });

    mockAgent
      .get("https://mybusiness.googleapis.com")
      .intercept({
        path: "/v4/accounts/123/locations/456/reviews?pageSize=5",
        method: "GET",
      })
      .reply(200, {
        reviews: [
          {
            reviewId: "review-1",
            starRating: "FIVE",
            comment: "Fast response and great local support.",
            reviewer: {
              displayName: "Taylor",
            },
            updateTime: "2026-04-24T13:00:00Z",
          },
        ],
      });

    const result = await probeGoogleBusinessProfile({
      accessToken: "google-token",
      accountId: "123",
      locationId: "456",
      dispatcher: mockAgent,
    });

    expect(result.account.accountName).toBe("Acme Managed Services");
    expect(result.location.title).toBe("Acme MSP - Austin");
    expect(result.reviews[0]?.reviewId).toBe("review-1");
  });

  it("throws a redacted error when Google rejects the credentials", async () => {
    mockAgent
      .get("https://mybusinessaccountmanagement.googleapis.com")
      .intercept({
        path: "/v1/accounts",
        method: "GET",
      })
      .reply(403, {
        error: {
          message: "Request had insufficient authentication scopes.",
        },
      });

    await expect(
      probeGoogleBusinessProfile({
        accessToken: "super-secret-google-token",
        accountId: "123",
        locationId: "456",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(GoogleBusinessProfileApiError);

    await expect(
      probeGoogleBusinessProfile({
        accessToken: "super-secret-google-token",
        accountId: "123",
        locationId: "456",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-google-token/);
  });
});
