import { describe, it, expect, afterEach } from "vitest";
import { getAdapter, listAdapters, __setAdaptersForTest } from "./registry";

describe("channel adapter registry", () => {
  afterEach(() => __setAdaptersForTest(null));

  it("resolves linkedin-personal-social by exact channel id", () => {
    const adapter = getAdapter("linkedin-personal-social");
    expect(adapter?.channelId).toBe("linkedin-personal-social");
  });

  it("aliases bare 'linkedin' to the personal-social adapter (Phase 2)", () => {
    const adapter = getAdapter("linkedin");
    expect(adapter?.channelId).toBe("linkedin-personal-social");
  });

  it("returns null for unknown channel", () => {
    expect(getAdapter("snapchat")).toBeNull();
  });

  it("lists at least the LinkedIn adapter in Phase 2", () => {
    const adapters = listAdapters();
    expect(adapters.map((a) => a.channelId)).toContain("linkedin-personal-social");
  });

  it("resolves email-postmark by exact channel id (Phase 3)", () => {
    expect(getAdapter("email-postmark")?.channelId).toBe("email-postmark");
  });

  it("aliases bare 'email' to the email-postmark adapter (Phase 3)", () => {
    expect(getAdapter("email")?.channelId).toBe("email-postmark");
  });

  it("resolves linkedin-ads by exact channel id (Phase 4)", () => {
    expect(getAdapter("linkedin-ads")?.channelId).toBe("linkedin-ads");
  });

  it("linkedin-ads exposes place-ad + fetch-engagement capabilities", () => {
    const adapter = getAdapter("linkedin-ads");
    expect(adapter?.capabilities).toContain("place-ad");
    expect(adapter?.capabilities).toContain("fetch-engagement");
  });

  it("registers WordPress as projection-aware post/page/media publishing", () => {
    const adapter = getAdapter("wordpress-self-hosted");
    expect(adapter?.capabilities).toEqual(expect.arrayContaining(["publish-post", "publish-page", "upload-media", "upsert-content"]));
    expect(adapter?.projectionIntent).toBeTypeOf("function");
  });

  it("routes the legacy wordpress id through the canonical self-hosted adapter", () => {
    expect(getAdapter("wordpress")).toBe(getAdapter("wordpress-self-hosted"));
    expect(getAdapter("wordpress")?.channelId).toBe("wordpress-self-hosted");
  });
});
