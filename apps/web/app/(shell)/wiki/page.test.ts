import { describe, expect, it, vi } from "vitest";

import WikiAliasRedirect from "./page";

const redirectMock = vi.hoisted(() => vi.fn((target: string) => {
  throw new Error(`redirect:${target}`);
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("WikiAliasRedirect", () => {
  it("redirects the legacy wiki root to the coworker decisions surface", () => {
    expect(() => WikiAliasRedirect()).toThrow("redirect:/coworker-decisions");
    expect(redirectMock).toHaveBeenCalledWith("/coworker-decisions");
  });
});
