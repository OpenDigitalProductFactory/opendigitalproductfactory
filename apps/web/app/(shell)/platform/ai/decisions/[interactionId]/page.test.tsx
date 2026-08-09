import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn(() => {
  throw new Error("redirect");
});

vi.mock("next/navigation", () => ({ redirect }));

describe("legacy DecisionInteractionPage", () => {
  it("converges on the canonical, actionable decision record", async () => {
    const { default: DecisionInteractionPage } = await import("./page");

    await expect(
      DecisionInteractionPage({
        params: Promise.resolve({ interactionId: "DI-1" }),
      }),
    ).rejects.toThrow("redirect");

    expect(redirect).toHaveBeenCalledWith("/coworker-decisions/decisions/DI-1");
  });

  it("encodes interaction identifiers before redirecting", async () => {
    const { default: DecisionInteractionPage } = await import("./page");

    await expect(
      DecisionInteractionPage({
        params: Promise.resolve({ interactionId: "DI/unsafe" }),
      }),
    ).rejects.toThrow("redirect");

    expect(redirect).toHaveBeenCalledWith("/coworker-decisions/decisions/DI%2Funsafe");
  });
});
