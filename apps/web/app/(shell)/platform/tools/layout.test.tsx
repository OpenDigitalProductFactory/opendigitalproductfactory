import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/platform/PlatformTabNav", () => ({
  PlatformTabNav: () => <div data-component="platform-tab-nav" />,
}));

describe("ToolsLayout", () => {
  it("renders the platform family nav once and does not render a duplicate tools sub-nav", async () => {
    const { default: ToolsLayout } = await import("./layout");
    const html = renderToStaticMarkup(
      <ToolsLayout>
        <div>child content</div>
      </ToolsLayout>,
    );

    expect(html).toContain('data-component="platform-tab-nav"');
    // Regression guard: tools sub-nav was previously rendered a second time
    // here, duplicating the sub-items already shown by PlatformTabNav. See
    // BI-UI-DUPMENU01.
    expect(html).not.toContain('data-component="tools-tab-nav"');
    expect(html).toContain("child content");
  });
});
