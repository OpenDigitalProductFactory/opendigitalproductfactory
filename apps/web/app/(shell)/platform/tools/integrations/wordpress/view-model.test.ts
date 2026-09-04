import { describe, expect, it } from "vitest";

import { toWordPressConnectionViewState } from "./view-model";

describe("toWordPressConnectionViewState", () => {
  it("projects only safe connector identity, capability, and policy fields", () => {
    const view = toWordPressConnectionViewState({
      integrationId: "wordpress-self-hosted",
      provider: "wordpress",
      status: "connected",
      safeProjection: {
        siteUrl: "https://rescue.example",
        username: "dpf-publisher",
        siteName: "Second Chance Rescue",
        origin: "https://rescue.example",
        supportedResourceKinds: "post,page,media",
        supportedTaxonomies: "category,post_tag",
        unsupportedResourceTypes: "event,donation",
        canCreateDrafts: true,
        canPublishLive: false,
        canUploadMedia: true,
        publicPublicationEnabled: false,
        applicationPassword: "must-not-project",
      },
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-08-22T07:00:00.000Z"),
    });

    expect(view).toEqual(expect.objectContaining({
      status: "connected",
      siteName: "Second Chance Rescue",
      supportedResourceKinds: ["post", "page", "media"],
      supportedTaxonomies: ["category", "post_tag"],
      unsupportedResourceTypes: ["event", "donation"],
      canPublishLive: false,
      lastTestedAt: "2026-08-22T07:00:00.000Z",
    }));
    expect(JSON.stringify(view)).not.toContain("must-not-project");
  });

  it("uses bounded defaults when persisted projection values are malformed", () => {
    const view = toWordPressConnectionViewState({
      integrationId: "wordpress-self-hosted",
      provider: "wordpress",
      status: "error",
      safeProjection: {
        siteUrl: 42,
        supportedResourceKinds: ["post", 7],
        canCreateDrafts: "yes",
      },
      lastErrorMsg: "Reconnect with a dedicated WordPress user.",
      lastTestedAt: null,
    });

    expect(view.siteUrl).toBeNull();
    expect(view.supportedResourceKinds).toEqual([]);
    expect(view.canCreateDrafts).toBe(false);
    expect(view.lastErrorMsg).toMatch(/Reconnect/);
  });
});
