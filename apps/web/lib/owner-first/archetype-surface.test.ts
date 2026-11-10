import { describe, expect, it } from "vitest";
import { resolveCustomerSurface } from "./archetype-surface";

const CRM_TABS = [
  { label: "Accounts", href: "/customer" },
  { label: "Engagements", href: "/customer/engagements" },
  { label: "Pipeline", href: "/customer/opportunities" },
  { label: "Quotes", href: "/customer/quotes" },
  { label: "Orders", href: "/customer/sales-orders" },
  { label: "Sales Funnel", href: "/customer/funnel" },
  { label: "Marketing", href: "/customer/marketing" },
];

describe("resolveCustomerSurface", () => {
  it("suppresses commercial concepts that do not exist for a pet rescue", () => {
    const surface = resolveCustomerSurface("pet-rescue", CRM_TABS);

    expect(surface.title).toBe("Adoption & community");
    expect(surface.tabs).toEqual([
      { label: "People & partners", href: "/customer" },
      { label: "Adoption enquiries", href: "/customer/engagements" },
      { label: "Community outreach", href: "/customer/marketing" },
    ]);
    expect(surface.tabs.map((tab) => tab.label).join(" ")).not.toMatch(
      /pipeline|quotes|orders|sales funnel/i,
    );
    expect(surface.newEntry.buttonLabel).toBe("+ Add person or partner");
    expect(surface.detailSummary).toBe("Relationship records");
    expect(surface.shellLabel).toBe("Adoption & community");
  });

  it("uses the same rescue contract for animal shelters", () => {
    expect(resolveCustomerSurface("animal-shelter", CRM_TABS)).toEqual(
      resolveCustomerSurface("pet-rescue", CRM_TABS),
    );
  });

  it("preserves the generic CRM contract for other archetypes", () => {
    const surface = resolveCustomerSurface("professional-services", CRM_TABS);

    expect(surface.title).toBe("Customer");
    expect(surface.tabs).toEqual(CRM_TABS);
    expect(surface.newEntry.buttonLabel).toBe("+ New Account");
    expect(surface.detailSummary).toBe("All CRM detail");
    expect(surface.shellLabel).toBe("Customer");
  });
});
