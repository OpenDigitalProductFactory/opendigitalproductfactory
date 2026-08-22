import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionNav } from "./SectionNav";

describe("SectionNav", () => {
  it("renders pill families with the active family and sub-items", () => {
    const html = renderToStaticMarkup(
      <SectionNav
        config={{
          variant: "families",
          style: "pill",
          dataComponent: "platform-tab-nav",
          families: [
            { key: "overview", label: "Overview", href: "/platform", active: true },
            { key: "ai", label: "AI Operations", href: "/platform/ai", active: false },
          ],
          description: "Supervise platform operations.",
          subItems: [
            { label: "Platform Hub", href: "/platform", active: true },
            { label: "Schedule", href: "/platform/schedule", active: false },
          ],
        }}
      />,
    );

    expect(html).toContain('data-component="platform-tab-nav"');
    expect(html).toContain("AI Operations");
    expect(html).toContain('href="/platform/schedule"');
    expect(html).toContain("Supervise platform operations.");
    // Active family carries the accent fill; pills use the rounded-full chrome.
    expect(html).toContain("bg-[var(--dpf-accent)]/10");
    expect(html).toContain("rounded-full");
  });

  it("renders tab families and hides the sub-item panel when there are none", () => {
    const withSubs = renderToStaticMarkup(
      <SectionNav
        config={{
          variant: "families",
          style: "tab",
          dataComponent: "finance-tab-nav",
          families: [{ key: "revenue", label: "Revenue", href: "/finance/revenue", active: true }],
          description: "Revenue ops.",
          subItems: [{ label: "Invoices", href: "/finance/revenue/invoices", active: false }],
        }}
      />,
    );
    expect(withSubs).toContain("border-b-2"); // underline-style active tab
    expect(withSubs).toContain("Revenue ops.");
    expect(withSubs).toContain("Invoices");

    const noSubs = renderToStaticMarkup(
      <SectionNav
        config={{
          variant: "families",
          style: "tab",
          dataComponent: "finance-tab-nav",
          families: [{ key: "overview", label: "Overview", href: "/finance", active: true }],
          description: "Overview.",
          subItems: [],
        }}
      />,
    );
    // No sub-items -> the boxed panel (and its description) is not rendered.
    expect(noSubs).not.toContain("Overview.");
    expect(noSubs).not.toContain("rounded-b-xl");
  });

  it("renders grouped tabs with their labels", () => {
    const html = renderToStaticMarkup(
      <SectionNav
        config={{
          variant: "grouped",
          dataComponent: "ops-tab-nav",
          groups: [
            { label: "Delivery", tabs: [{ label: "Backlog", href: "/ops", active: true }] },
            {
              label: "Runtime & Releases",
              tabs: [{ label: "Changes", href: "/ops/changes", active: false }],
            },
          ],
        }}
      />,
    );

    expect(html).toContain('data-component="ops-tab-nav"');
    expect(html).toContain("Delivery");
    expect(html).toContain("Runtime &amp; Releases");
    expect(html).toContain("Backlog");
    expect(html).toContain('href="/ops/changes"');
    expect(html).toContain("border-b-2"); // active Backlog tab
    expect(html).toContain("min-w-0 max-w-full");
    expect(html).toContain("flex flex-wrap gap-1");
  });
});
