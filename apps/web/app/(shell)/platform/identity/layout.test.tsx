import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/platform/PlatformTabNav", () => ({
  PlatformTabNav: () => <div>platform-tab-nav</div>,
}));

vi.mock("@/components/platform/identity/IdentityTabNav", () => ({
  IdentityTabNav: () => <div>identity-tab-nav</div>,
}));

describe("IdentityLayout", () => {
  it("renders the platform family nav without duplicating a second identity tab strip", async () => {
    const { default: IdentityLayout } = await import("./layout");
    const html = renderToStaticMarkup(
      <IdentityLayout>
        <div>identity-page</div>
      </IdentityLayout>,
    );

    expect(html).toContain("platform-tab-nav");
    expect(html).toContain("identity-page");
    expect(html).not.toContain("identity-tab-nav");
  });
});
