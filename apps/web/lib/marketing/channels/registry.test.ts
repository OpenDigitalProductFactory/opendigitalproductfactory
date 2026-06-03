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
});
