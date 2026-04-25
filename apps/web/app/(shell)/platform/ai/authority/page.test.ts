import { describe, expect, it, vi } from "vitest";

const permanentRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  permanentRedirect,
}));

describe("AiAuthorityLegacyPage", () => {
  it("redirects legacy AI authority links back to the AI Operations overview", async () => {
    const { default: AiAuthorityLegacyPage } = await import("./page");

    await AiAuthorityLegacyPage();

    expect(permanentRedirect).toHaveBeenCalledWith("/platform/ai");
  });
});
