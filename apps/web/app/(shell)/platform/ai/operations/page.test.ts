import { describe, expect, it, vi } from "vitest";

const permanentRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  permanentRedirect,
}));

describe("AiOperationsLegacyPage", () => {
  it("redirects legacy AI operations links to the AI build runtime page", async () => {
    const { default: AiOperationsLegacyPage } = await import("./page");

    await AiOperationsLegacyPage();

    expect(permanentRedirect).toHaveBeenCalledWith("/platform/ai/build-studio");
  });
});
