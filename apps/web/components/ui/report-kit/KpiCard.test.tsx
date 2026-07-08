import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders value and label", () => {
    const html = renderToStaticMarkup(<KpiCard value="42" label="Open invoices" />);
    expect(html).toContain("42");
    expect(html).toContain("Open invoices");
  });

  it("colors the value from intent (token, no hex)", () => {
    const html = renderToStaticMarkup(
      <KpiCard value="3" label="Overdue" intent="danger" />,
    );
    expect(html).toContain("var(--dpf-error)");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("scales value typography by size", () => {
    expect(renderToStaticMarkup(<KpiCard value="1" label="a" size="sm" />)).toContain(
      "text-2xl",
    );
    expect(renderToStaticMarkup(<KpiCard value="1" label="a" size="lg" />)).toContain(
      "text-4xl",
    );
  });

  it("renders as a link when href is provided", () => {
    const html = renderToStaticMarkup(
      <KpiCard value="5" label="Paid" href="/finance/invoices" />,
    );
    expect(html).toContain('href="/finance/invoices"');
  });

  it("drops the card chrome in borderless mode", () => {
    const html = renderToStaticMarkup(<KpiCard value="7" label="Total" bordered={false} />);
    expect(html).not.toContain("border-left-width");
  });
});
