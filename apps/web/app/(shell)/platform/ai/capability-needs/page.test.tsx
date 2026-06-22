import { describe, expect, it, vi } from "vitest";

// EP-INTAKE-UNIFY surface convergence: the standalone capability-needs page is
// retired to a redirect into the one Operations surface (/ops). Capability needs
// are backlog items, seen there via the "Capability need" origin lens.
const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

describe("CapabilityNeedsRedirect", () => {
  it("redirects to the converged Operations surface with the capability-need origin", async () => {
    const { default: CapabilityNeedsRedirect } = await import("./page");
    CapabilityNeedsRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/ops?origin=capability-need");
  });
});
