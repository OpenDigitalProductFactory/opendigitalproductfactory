import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/platform/PlatformTabNav", () => ({
  PlatformTabNav: () => <nav>Platform navigation</nav>,
}));

describe("PlatformArchetypeReadinessPage", () => {
  it("renders the operator archetype readiness surface", async () => {
    const { default: PlatformArchetypeReadinessPage } = await import("./page");
    const html = renderToStaticMarkup(<PlatformArchetypeReadinessPage />);

    expect(html).toContain("Type claims");
    expect(html).toContain("Platform navigation");
    expect(html).toContain("Gate is on");
    expect(html).toContain("data-dpf-lead");
    expect(html).toContain("data-owner-first-next-action");
    expect(html).toContain("Open the table");
    expect(html).toContain("BI-PSC-010");
  });
});
