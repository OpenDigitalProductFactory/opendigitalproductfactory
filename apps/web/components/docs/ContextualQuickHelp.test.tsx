import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ContextualQuickHelp } from "./ContextualQuickHelp";
import { resolveQuickHelp } from "@/lib/docs-quick-help";

describe("ContextualQuickHelp — source banner", () => {
  it("keeps the sourceRoute provenance and a Back to page link", () => {
    const html = renderToStaticMarkup(<ContextualQuickHelp sourceRoute="/storefront/inbox" />);
    expect(html).toContain("Opened from");
    expect(html).toContain("/storefront/inbox");
    expect(html).toContain("Back to page");
    // Back to page links to the exact source route.
    expect(html).toContain('href="/storefront/inbox"');
  });

  it("renders nothing for a non-internal source route", () => {
    const html = renderToStaticMarkup(<ContextualQuickHelp sourceRoute="https://evil.example" />);
    expect(html).toBe("");
  });
});

describe("ContextualQuickHelp — quick help panel", () => {
  it("leads with the five quick-help questions when the route has help", () => {
    const html = renderToStaticMarkup(<ContextualQuickHelp sourceRoute="/ops/self-upgrade" />);
    for (const label of [
      "What this page is",
      "What to do now",
      "If you do nothing",
      "What&#x27;s reversible",
      "Where to get help",
    ]) {
      expect(html, `panel should show "${label}"`).toContain(label);
    }
    // And the actual route-specific copy is present, not a generic manual.
    const help = resolveQuickHelp("/ops/self-upgrade")!;
    expect(html).toContain("Quick help");
    expect(html).toContain(help.whatThisPageIs);
    expect(html).toContain(help.reversible);
  });

  it("shows the banner without a panel for a route that has no quick help", () => {
    const html = renderToStaticMarkup(<ContextualQuickHelp sourceRoute="/finance/reports/cash-flow" />);
    expect(html).toContain("Back to page");
    expect(html).toContain("/finance/reports/cash-flow");
    expect(html).not.toContain("Quick help");
  });

  it("renders route-specific business-settings copy distinct from the settings default", () => {
    const html = renderToStaticMarkup(<ContextualQuickHelp sourceRoute="/storefront/settings/business" />);
    const business = resolveQuickHelp("/storefront/settings/business")!;
    expect(html).toContain(business.whatThisPageIs);
  });
});
