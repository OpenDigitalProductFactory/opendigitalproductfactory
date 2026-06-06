import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerMetricTile } from "./CustomerMetricTile";

describe("CustomerMetricTile", () => {
  it("renders a linked metric through the shared report-kit StatCard", () => {
    const html = renderToStaticMarkup(
      <CustomerMetricTile
        href="/customer/opportunities"
        label="Pipeline"
        value="3"
        detail="£6,000 open"
        tone="accent"
      />,
    );

    expect(html).toContain('href="/customer/opportunities"');
    expect(html).toContain(">Pipeline<");
    expect(html).toContain(">3<");
    expect(html).toContain("£6,000 open");
    expect(html).toContain("border-left-color:var(--dpf-accent)");
    expect(html).not.toContain("border-[var(--dpf-accent)]");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
