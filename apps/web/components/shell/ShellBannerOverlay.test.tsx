import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ShellBannerOverlay } from "./ShellBannerOverlay";

describe("ShellBannerOverlay", () => {
  it("floats shell notices over the page instead of taking document flow space", () => {
    const html = renderToStaticMarkup(
      <ShellBannerOverlay>
        <div>Notice</div>
      </ShellBannerOverlay>,
    );

    expect(html).toContain("fixed");
    expect(html).toContain("top-0");
    expect(html).not.toContain("top-20");
    expect(html).not.toMatch(/\b(?:[a-z]+:)?pt-/);
    expect(html).toContain("pointer-events-none");
    expect(html).toContain('data-testid="shell-banner-overlay"');
  });
});
