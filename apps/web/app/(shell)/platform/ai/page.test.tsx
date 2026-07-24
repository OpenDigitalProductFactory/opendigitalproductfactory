import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());
const permanentRedirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  permanentRedirect: permanentRedirectMock,
}));

describe("PlatformAiPage", () => {
  it("resolves the AI section default to the workforce directory", async () => {
    const { default: PlatformAiPage } = await import("./page");
    await PlatformAiPage();

    expect(redirectMock).toHaveBeenCalledWith("/platform/ai/overview");
  });

  it("uses a temporary redirect, never a browser-cached permanent one (BI-54A93A3C)", () => {
    // This route is a section FRONT DOOR, not a relocated page. A 308 is cached
    // hard and durably by browsers, so re-pointing the section's landing surface
    // later would strand every operator whose browser had already seen the old
    // target — a bug that only reproduces on machines which visited the old URL,
    // which makes it miserable to diagnose. Genuinely moved pages
    // (admin/prompts, admin/skills) legitimately keep permanentRedirect.
    expect(permanentRedirectMock).not.toHaveBeenCalled();
  });
});
