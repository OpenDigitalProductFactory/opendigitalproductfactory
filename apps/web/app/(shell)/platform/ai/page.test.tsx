import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  permanentRedirect: redirectMock,
}));

describe("PlatformAiPage", () => {
  it("resolves the AI section default to readiness", async () => {
    const { default: PlatformAiPage } = await import("./page");
    await PlatformAiPage();

    expect(redirectMock).toHaveBeenCalledWith("/platform/ai/readiness");
  });
});
