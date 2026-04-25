import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/platform/PlatformTabNav", () => ({
  PlatformTabNav: () => <div data-component="platform-tab-nav" />,
}));

vi.mock("@/components/platform/ToolsTabNav", () => ({
  ToolsTabNav: () => <div data-component="tools-tab-nav" />,
}));

describe("ToolsLayout", () => {
  it("renders both the platform family nav and the tools sub-navigation", async () => {
    const { default: ToolsLayout } = await import("./layout");
    const html = renderToStaticMarkup(
      <ToolsLayout>
        <div>child content</div>
      </ToolsLayout>,
    );

    expect(html).toContain('data-component="platform-tab-nav"');
    expect(html).toContain('data-component="tools-tab-nav"');
    expect(html).toContain("child content");
  });
});
