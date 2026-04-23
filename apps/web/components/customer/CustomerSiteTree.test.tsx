import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./NewCustomerSiteNodeButton", () => ({
  NewCustomerSiteNodeButton: ({ label = "+ Add Sublocation" }: { label?: string }) => (
    <button type="button">{label}</button>
  ),
}));

import { CustomerSiteTree } from "./CustomerSiteTree";

describe("CustomerSiteTree", () => {
  it("renders an empty state when no sites exist", () => {
    const html = renderToStaticMarkup(<CustomerSiteTree accountId="acct-1" sites={[]} />);

    expect(html).toContain("No customer sites registered yet.");
  });

  it("renders sites with nested nodes and textual operational context", () => {
    const html = renderToStaticMarkup(
      <CustomerSiteTree
        accountId="acct-1"
        sites={[
          {
            id: "site-1",
            siteId: "SITE-001",
            name: "Dallas HQ",
            siteType: "office",
            status: "active",
            timezone: "America/Chicago",
            accessInstructions: "Check in at reception.",
            hoursNotes: "Weekdays 8am-6pm.",
            serviceNotes: "Primary managed office.",
            primaryAddress: {
              addressLine1: "123 Main St",
              addressLine2: "Suite 400",
              postalCode: "75201",
              validationSource: "manual",
              validatedAt: new Date("2026-04-23T00:00:00.000Z"),
              city: {
                name: "Dallas",
                region: {
                  name: "Texas",
                  country: {
                    iso2: "US",
                  },
                },
              },
            },
            nodes: [
              {
                id: "node-1",
                nodeId: "NODE-1",
                siteId: "site-1",
                parentNodeId: null,
                name: "Floor 3",
                nodeType: "floor",
                status: "active",
                notes: "Main support floor.",
              },
              {
                id: "node-2",
                nodeId: "NODE-2",
                siteId: "site-1",
                parentNodeId: "node-1",
                name: "Server Room",
                nodeType: "room",
                status: "active",
                notes: "Badge required.",
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Dallas HQ");
    expect(html).toContain("123 Main St");
    expect(html).toContain("Dallas, Texas 75201");
    expect(html).toContain("Check in at reception.");
    expect(html).toContain("Weekdays 8am-6pm.");
    expect(html).toContain("Primary managed office.");
    expect(html).toContain("Floor 3");
    expect(html).toContain("Server Room");
    expect(html).toContain("Badge required.");
  });
});
