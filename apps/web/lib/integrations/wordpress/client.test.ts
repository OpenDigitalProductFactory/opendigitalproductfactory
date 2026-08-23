import { describe, expect, it, vi } from "vitest";

import { WordPressClientError, createWordPressClient } from "./client";

const credential = {
  siteUrl: "https://wordpress.example",
  username: "dpf-publisher",
  applicationPassword: "app-password",
};

describe("WordPress REST client", () => {
  it("discovers the site and bounded supported resource schemas", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { name: "Acme", url: "https://wordpress.example", namespaces: ["wp/v2", "plugin/v1"] } })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: [{ slug: "post", rest_base: "posts" }, { slug: "page", rest_base: "pages" }, { slug: "book", rest_base: "books" }] })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { category: { slug: "category" }, post_tag: { slug: "post_tag" } } })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { id: 7, name: "DPF Publisher", capabilities: { edit_posts: true, publish_posts: false, upload_files: true } } });
    const probe = await createWordPressClient({ credential, request }).probe();
    expect(probe).toEqual(expect.objectContaining({
      siteName: "Acme",
      origin: "https://wordpress.example",
      authenticatedUser: { id: 7, name: "DPF Publisher" },
      supportedResourceKinds: ["post", "page", "media"],
      canPublishLive: false,
      supportedTaxonomies: ["category", "post_tag"],
      unsupportedResourceTypes: ["book"],
    }));
    expect(JSON.stringify(probe)).not.toContain("app-password");
    expect(JSON.stringify(probe)).not.toContain("plugin/v1");
  });

  it.each([
    [401, "authentication_failed", false],
    [403, "permission_denied", false],
    [404, "rest_unavailable", false],
    [429, "rate_limited", true],
    [503, "upstream_unavailable", true],
  ] as const)("classifies HTTP %s", async (status, code, retryable) => {
    const request = vi.fn(async () => ({ status, headers: new Headers(), data: {} }));
    await expect(createWordPressClient({ credential, request }).probe())
      .rejects.toMatchObject({ code, retryable });
  });

  it("uses an existing id for updates and returns ambiguous on an unknown create outcome", async () => {
    const request = vi.fn(async ({ method }: { method?: string }) => {
      if (method === "POST") throw new WordPressClientError("network_timeout", "outcome unknown", true, true);
      return { status: 200, headers: new Headers(), data: {} };
    });
    const client = createWordPressClient({ credential, request });
    await expect(client.upsertContent({ resourceKind: "post", externalId: null, payload: { title: "Hello", content: "World", status: "draft" } }))
      .rejects.toMatchObject({ ambiguous: true });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "https://wordpress.example/wp-json/wp/v2/posts", method: "POST" }));
  });

  it("treats an invalid total-pages header as one bounded page", async () => {
    const request = vi.fn(async () => ({ status: 200, headers: new Headers({ "x-wp-totalpages": "not-a-number" }), data: [] }));
    await expect(createWordPressClient({ credential, request }).list("post", { page: 1, pageSize: 50 }))
      .resolves.toMatchObject({ records: [], totalPages: 1 });
  });
});
