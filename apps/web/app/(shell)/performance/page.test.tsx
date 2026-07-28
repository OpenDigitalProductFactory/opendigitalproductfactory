import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import PerformancePage, { metadata } from "./page";

describe("PerformancePage", () => {
  it("states its owner/manager purpose and renders a truthful setup state", async () => {
    const html = renderToStaticMarkup(await PerformancePage());

    expect(metadata.title).toBe("Performance");
    expect(html).toContain(">Performance<");
    expect(html).toContain("Review how the business is doing over time.");
    expect(html).toContain("Connect a source to see performance");
    expect(html).toContain("We will not show made-up numbers.");
    expect(html).toContain('href="/workspace"');
    expect(html).toContain("data-dpf-lead");
    expect(html).toContain("data-owner-first-next-action");
    expect(html).toContain("data-dpf-primary-action");
    expect(html).not.toContain(">0<");
  });

  it("does not add a second primary or local navigation component", async () => {
    const html = renderToStaticMarkup(await PerformancePage());

    expect(html).not.toContain("<nav");
    expect(html).not.toContain("data-component=\"app-rail\"");
  });
});
