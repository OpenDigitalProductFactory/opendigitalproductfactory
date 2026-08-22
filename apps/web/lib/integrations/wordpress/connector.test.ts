import { describe, expect, it } from "vitest";

import {
  createWordPressConnectorAdapter,
  parseWordPressCredential,
  wordpressConnectorDefinition,
} from "./connector";

describe("wordpress connector contract", () => {
  it("registers outbound-only discovery, observation, and incremental reads", () => {
    expect(wordpressConnectorDefinition).toMatchObject({
      key: "wordpress-self-hosted",
      auth: { kind: "api-key" },
      callback: { kind: "none" },
      sync: { kind: "incremental", operationId: "read-content" },
      authorities: expect.arrayContaining([
        { resource: "wordpress.managed-content", mode: "platform" },
        { resource: "wordpress.presentation", mode: "source" },
        { resource: "wordpress.discovery", mode: "source" },
        { resource: "wordpress.taxonomy-slug", mode: "shared" },
      ]),
    });
  });

  it("normalizes an HTTPS site URL but never serializes the application password into a safe projection", async () => {
    const parsed = await parseWordPressCredential({
      siteUrl: "https://Example.COM/blog/",
      username: "editor",
      applicationPassword: "abcd efgh ijkl mnop",
    });
    expect(parsed.credential.siteUrl).toBe("https://example.com/blog");
    expect(parsed.serialized.secretFields).toEqual({ applicationPassword: "abcd efgh ijkl mnop" });
    expect(JSON.stringify(parsed.serialized.safeProjection)).not.toContain("abcd");
  });

  it("rejects HTTP, embedded credentials, and unsafe URL components", async () => {
    for (const siteUrl of [
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com/?redirect=evil",
      "https://example.com/#fragment",
    ]) {
      await expect(parseWordPressCredential({ username: "editor", applicationPassword: "secret", siteUrl }))
        .rejects.toThrow();
    }
  });

  it("connects through the kernel credential envelope and returns only bounded probe evidence", async () => {
    const probe = async () => ({
      siteName: "Acme",
      origin: "https://wordpress.example",
      authenticatedUser: { id: 7, name: "Publisher" },
      supportedResourceKinds: ["post", "page", "media"] as Array<"post" | "page" | "media">,
      canCreateDrafts: true,
      canPublishLive: false,
      canUploadMedia: true,
    });
    const result = await createWordPressConnectorAdapter({ createClient: () => ({ probe }) }).connect({
      siteUrl: "https://wordpress.example",
      username: "publisher",
      applicationPassword: "secret",
    });
    expect(result.credential).toMatchObject({
      integrationId: "wordpress-self-hosted",
      provider: "wordpress",
      reconnectFields: { siteUrl: "https://wordpress.example", username: "publisher" },
      secretFields: { applicationPassword: "secret" },
      safeProjection: { siteName: "Acme", canPublishLive: false },
    });
    expect(JSON.stringify(result.probe)).not.toContain("secret");
  });
});
