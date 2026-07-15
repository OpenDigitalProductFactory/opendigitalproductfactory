import { describe, expect, it, vi } from "vitest";

import WikiAliasSlugRedirect from "./page";

const redirectMock = vi.hoisted(() => vi.fn((target: string) => {
  throw new Error(`redirect:${target}`);
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("WikiAliasSlugRedirect", () => {
  it("redirects legacy wiki child paths to the renamed coworker decisions path", async () => {
    await expect(
      WikiAliasSlugRedirect({ params: Promise.resolve({ slug: ["stance"] }) }),
    ).rejects.toThrow("redirect:/coworker-decisions/stance");
    expect(redirectMock).toHaveBeenCalledWith("/coworker-decisions/stance");
  });

  it("preserves nested wiki child paths", async () => {
    await expect(
      WikiAliasSlugRedirect({ params: Promise.resolve({ slug: ["perspectives", "P-1", "voice"] }) }),
    ).rejects.toThrow("redirect:/coworker-decisions/perspectives/P-1/voice");
    expect(redirectMock).toHaveBeenCalledWith("/coworker-decisions/perspectives/P-1/voice");
  });
});
