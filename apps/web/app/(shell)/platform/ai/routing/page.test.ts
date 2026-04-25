import { describe, expect, it, vi } from "vitest";

const permanentRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  permanentRedirect,
}));

describe("AiRoutingLegacyPage", () => {
  it("redirects legacy AI routing links to providers and routing", async () => {
    const { default: AiRoutingLegacyPage } = await import("./page");

    await AiRoutingLegacyPage();

    expect(permanentRedirect).toHaveBeenCalledWith("/platform/ai/providers");
  });
});
