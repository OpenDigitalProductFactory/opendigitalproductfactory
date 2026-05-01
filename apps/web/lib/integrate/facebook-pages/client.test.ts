import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  FacebookPagesApiError,
  probeFacebookPages,
  resolveFacebookGraphApiBaseUrl,
} from "./client";

describe("resolveFacebookGraphApiBaseUrl", () => {
  const original = process.env.FACEBOOK_GRAPH_API_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    } else {
      process.env.FACEBOOK_GRAPH_API_BASE_URL = original;
    }
  });

  it("defaults to the public Facebook Graph host", () => {
    delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    expect(resolveFacebookGraphApiBaseUrl()).toBe("https://graph.facebook.com");
  });

  it("honors an explicit base URL override for harness tests", () => {
    process.env.FACEBOOK_GRAPH_API_BASE_URL = "http://integration-test-harness:8700";
    expect(resolveFacebookGraphApiBaseUrl()).toBe("http://integration-test-harness:8700");
  });
});

describe("probeFacebookPages", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns page details plus recent posts and comments", async () => {
    const pool = mockAgent.get("https://graph.facebook.com");
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/123456789?") &&
          value.includes("fields=id%2Cname%2Ccategory%2Clink%2Cfan_count"),
        method: "GET",
      })
      .reply(200, {
        id: "123456789",
        name: "Acme Managed Services",
        category: "Business service",
        link: "https://www.facebook.com/acme",
        fan_count: 284,
      });
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/123456789/posts?") &&
          value.includes("fields=id%2Cmessage%2Ccreated_time%2Cpermalink_url"),
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "post-1",
            message: "Free onsite network review this Thursday.",
            created_time: "2026-04-24T15:00:00.000Z",
            permalink_url: "https://facebook.com/post-1",
          },
        ],
      });
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/post-1/comments?") &&
          value.includes("fields=id%2Cmessage%2Ccreated_time%2Cfrom"),
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "comment-1",
            message: "Do you cover Round Rock?",
            created_time: "2026-04-24T16:00:00.000Z",
            from: {
              name: "Taylor",
            },
          },
        ],
      });

    const result = await probeFacebookPages({
      accessToken: "meta-token",
      pageId: "123456789",
      dispatcher: mockAgent,
    });

    expect(result.page.name).toBe("Acme Managed Services");
    expect(result.page.fanCount).toBe(284);
    expect(result.recentPosts[0]?.id).toBe("post-1");
    expect(result.recentComments[0]?.id).toBe("comment-1");
  });

  it("throws a redacted error on unauthorized access", async () => {
    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: (value) => value.startsWith("/123456789?"),
        method: "GET",
      })
      .reply(403, {
        error: {
          message: "Unsupported get request.",
        },
      });

    await expect(
      probeFacebookPages({
        accessToken: "super-secret-meta-token",
        pageId: "123456789",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(FacebookPagesApiError);

    await expect(
      probeFacebookPages({
        accessToken: "super-secret-meta-token",
        pageId: "123456789",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-meta-token/);
  });
});
