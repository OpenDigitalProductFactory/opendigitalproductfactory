import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  MailchimpApiError,
  probeMailchimpAccount,
  resolveMailchimpApiBaseUrl,
} from "./client";

describe("Mailchimp API base URL", () => {
  const originalBaseUrl = process.env.MAILCHIMP_API_BASE_URL;

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.MAILCHIMP_API_BASE_URL;
    } else {
      process.env.MAILCHIMP_API_BASE_URL = originalBaseUrl;
    }
  });

  it("derives the public Mailchimp host from the server prefix", () => {
    delete process.env.MAILCHIMP_API_BASE_URL;
    expect(resolveMailchimpApiBaseUrl("us21")).toBe("https://us21.api.mailchimp.com");
  });

  it("honors an explicit harness override", () => {
    process.env.MAILCHIMP_API_BASE_URL = "http://integration-test-harness:8700/mailchimp";
    expect(resolveMailchimpApiBaseUrl("us21")).toBe("http://integration-test-harness:8700/mailchimp");
  });
});

describe("probeMailchimpAccount", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns account, recent audiences, and recent campaigns", async () => {
    mockAgent
      .get("https://us21.api.mailchimp.com")
      .intercept({ path: "/3.0/", method: "GET" })
      .reply(200, {
        account_name: "Acme Growth",
        login_name: "owner@example.com",
        email: "owner@example.com",
        role: "admin",
      });

    mockAgent
      .get("https://us21.api.mailchimp.com")
      .intercept({ path: "/3.0/lists?count=5", method: "GET" })
      .reply(200, {
        lists: [
          {
            id: "list-1",
            name: "Austin Leads",
            stats: { member_count: 42 },
          },
        ],
      });

    mockAgent
      .get("https://us21.api.mailchimp.com")
      .intercept({ path: "/3.0/campaigns?count=5", method: "GET" })
      .reply(200, {
        campaigns: [
          {
            id: "cmp-1",
            settings: { title: "April Follow-up" },
            status: "save",
          },
        ],
      });

    const result = await probeMailchimpAccount({
      apiKey: "secret-us21",
      serverPrefix: "us21",
      dispatcher: mockAgent,
    });

    expect(result.account.accountName).toBe("Acme Growth");
    expect(result.audiences[0]?.id).toBe("list-1");
    expect(result.campaigns[0]?.id).toBe("cmp-1");
  });

  it("throws a redacted error when Mailchimp rejects the API key", async () => {
    mockAgent
      .get("https://us21.api.mailchimp.com")
      .intercept({ path: "/3.0/", method: "GET" })
      .reply(401, { detail: "Your API key may be invalid." });

    await expect(
      probeMailchimpAccount({
        apiKey: "super-secret-us21",
        serverPrefix: "us21",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(MailchimpApiError);

    await expect(
      probeMailchimpAccount({
        apiKey: "super-secret-us21",
        serverPrefix: "us21",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-us21/);
  });
});
