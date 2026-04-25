import { describe, expect, it, vi } from "vitest";

const permanentRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  permanentRedirect,
}));

describe("AdminSkillsPage", () => {
  it("redirects to the AI Operations skills page", async () => {
    const { default: AdminSkillsPage } = await import("./page");

    await AdminSkillsPage();

    expect(permanentRedirect).toHaveBeenCalledWith("/platform/ai/skills");
  });
});
