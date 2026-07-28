import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import PerformanceLoading from "./loading";

describe("PerformanceLoading", () => {
  it("uses the shared skeleton grammar with an accessible page-level label", () => {
    const html = renderToStaticMarkup(<PerformanceLoading />);

    expect(html).toContain('aria-label="Loading business performance"');
    expect(html).toContain('aria-label="Loading metrics"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("border-t-transparent");
  });
});
