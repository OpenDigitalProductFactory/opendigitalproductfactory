import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";

import {
  InstagramBusinessApiError,
  probeInstagramBusiness,
  resolveInstagramGraphApiBaseUrl,
} from "./client";

describe("resolveInstagramGraphApiBaseUrl", () => {
  const original = process.env.FACEBOOK_GRAPH_API_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    } else {
      process.env.FACEBOOK_GRAPH_API_BASE_URL = original;
    }
  });

  it("defaults to the public Meta Graph API host", () => {
    delete process.env.FACEBOOK_GRAPH_API_BASE_URL;
    expect(resolveInstagramGraphApiBaseUrl()).toBe("https://graph.facebook.com");
  });
});

describe("probeInstagramBusiness", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns profile, recent media, and first-media comments", async () => {
    const pool = mockAgent.get("https://graph.facebook.com");
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v21.0/ig-123?") &&
          value.includes("fields=id%2Cusername%2Cname%2Cbiography%2Cwebsite%2Cfollowers_count%2Cfollows_count%2Cmedia_count%2Cprofile_picture_url"),
        method: "GET",
      })
      .reply(200, {
        id: "ig-123",
        username: "acme_austin",
        name: "Acme Austin",
        biography: "Local service team",
        website: "https://example.com/austin",
        followers_count: 1240,
        follows_count: 120,
        media_count: 84,
        profile_picture_url: "https://cdn.example.com/profile.jpg",
      });
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v21.0/ig-123/media?") &&
          value.includes("fields=id%2Ccaption%2Cmedia_type%2Cmedia_product_type%2Cpermalink%2Ctimestamp%2Clike_count%2Ccomments_count"),
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "media-1",
            caption: "Austin appointments open this Friday.",
            media_type: "IMAGE",
            media_product_type: "FEED",
            permalink: "https://instagram.com/p/media-1",
            timestamp: "2026-05-01T14:00:00+0000",
            like_count: 42,
            comments_count: 3,
          },
        ],
      });
    pool
      .intercept({
        path: (value) =>
          value.startsWith("/v21.0/media-1/comments?") &&
          value.includes("fields=id%2Ctext%2Cusername%2Ctimestamp"),
        method: "GET",
      })
      .reply(200, {
        data: [
          {
            id: "comment-1",
            text: "Do you cover Round Rock?",
            username: "localbuyer",
            timestamp: "2026-05-01T15:00:00+0000",
          },
        ],
      });

    const result = await probeInstagramBusiness({
      accessToken: "meta-token",
      instagramBusinessAccountId: "ig-123",
      dispatcher: mockAgent,
    });

    expect(result.profile.username).toBe("acme_austin");
    expect(result.profile.followersCount).toBe(1240);
    expect(result.recentMedia[0]).toMatchObject({
      id: "media-1",
      caption: "Austin appointments open this Friday.",
      commentsCount: 3,
    });
    expect(result.recentComments[0]).toMatchObject({
      id: "comment-1",
      text: "Do you cover Round Rock?",
      username: "localbuyer",
    });
  });

  it("throws a redacted error on unauthorized access", async () => {
    mockAgent
      .get("https://graph.facebook.com")
      .intercept({
        path: (value) => value.startsWith("/v21.0/ig-123?"),
        method: "GET",
      })
      .reply(403, { error: { message: "token super-secret-meta-token rejected" } });

    await expect(
      probeInstagramBusiness({
        accessToken: "super-secret-meta-token",
        instagramBusinessAccountId: "ig-123",
        dispatcher: mockAgent,
      }),
    ).rejects.toThrow(InstagramBusinessApiError);

    await expect(
      probeInstagramBusiness({
        accessToken: "super-secret-meta-token",
        instagramBusinessAccountId: "ig-123",
        dispatcher: mockAgent,
      }),
    ).rejects.not.toThrow(/super-secret-meta-token/);
  });
});
