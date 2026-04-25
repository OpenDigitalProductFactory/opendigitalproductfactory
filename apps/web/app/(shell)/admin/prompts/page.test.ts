import { describe, expect, it, vi } from "vitest";

const permanentRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  permanentRedirect,
}));

describe("AdminPromptsPage", () => {
  it("redirects to the AI Operations prompts page", async () => {
    const { default: AdminPromptsPage } = await import("./page");

    await AdminPromptsPage();

    expect(permanentRedirect).toHaveBeenCalledWith("/platform/ai/prompts");
  });
});
