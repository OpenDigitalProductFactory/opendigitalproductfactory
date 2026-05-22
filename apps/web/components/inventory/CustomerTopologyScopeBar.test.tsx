import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomerTopologyScopeBar } from "./CustomerTopologyScopeBar";

describe("CustomerTopologyScopeBar", () => {
  it("shows customer and site context for customer-site topology", () => {
    const html = renderToStaticMarkup(
      <CustomerTopologyScopeBar
        scopeLabel="Acme Dental"
        siteLabel="Austin Office"
        mode="customer-site"
        lastRunLabel="Last discovery 4m ago"
      />,
    );

    expect(html).toContain("Acme Dental");
    expect(html).toContain("Austin Office");
    expect(html).toContain("Last discovery 4m ago");
    expect(html).toContain("Customer estate");
    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).toContain("border-[var(--dpf-border)]");
  });

  it("makes internal MSP topology explicit", () => {
    const html = renderToStaticMarkup(
      <CustomerTopologyScopeBar scopeLabel="MSP Internal" mode="organization-internal" />,
    );

    expect(html).toContain("MSP Internal");
    expect(html).toContain("Internal estate");
  });

  it("renders edge node and last run badges when supplied", () => {
    const html = renderToStaticMarkup(
      <CustomerTopologyScopeBar
        scopeLabel="Acme Dental"
        siteLabel="Austin Office"
        mode="customer-site"
        edgeNodeLabel="edge-austin-01"
        lastRunLabel="Last discovery 4m ago"
      />,
    );

    expect(html).toContain("edge-austin-01");
    expect(html).toContain("Last discovery 4m ago");
  });
});
