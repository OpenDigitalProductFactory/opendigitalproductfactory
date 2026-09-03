export type CustomerSurfaceTab = { label: string; href: string };

export type CustomerSurface = {
  title: string;
  accountCountLabel: string;
  tabs: CustomerSurfaceTab[];
  newEntry: {
    buttonLabel: string;
    title: string;
    nameLabel: string;
    namePlaceholder: string;
  };
  detailSummary: string;
  detailHint: string;
};

const RESCUE_ARCHETYPES = new Set(["pet-rescue", "animal-shelter"]);

/** Keep real CRM routes, but expose only concepts that exist for the archetype. */
export function resolveCustomerSurface(
  archetypeId: string | null | undefined,
  availableTabs: CustomerSurfaceTab[],
): CustomerSurface {
  if (RESCUE_ARCHETYPES.has((archetypeId ?? "").trim().toLowerCase())) {
    const allowed = new Map([
      ["/customer", "People & partners"],
      ["/customer/engagements", "Adoption enquiries"],
      ["/customer/marketing", "Community outreach"],
    ]);
    return {
      title: "Adoption & community",
      accountCountLabel: "people & partners",
      tabs: availableTabs
        .filter((tab) => allowed.has(tab.href))
        .map((tab) => ({ ...tab, label: allowed.get(tab.href)! })),
      newEntry: {
        buttonLabel: "+ Add person or partner",
        title: "New person or partner",
        nameLabel: "Name *",
        namePlaceholder: "e.g. Foster family or veterinary partner",
      },
      detailSummary: "Relationship records",
      detailHint: "Adopters, foster families, surrenderers, volunteers, donors, and partners",
    };
  }

  return {
    title: "Customer",
    accountCountLabel: "accounts",
    tabs: availableTabs,
    newEntry: {
      buttonLabel: "+ New Account",
      title: "New Customer Account",
      nameLabel: "Account Name *",
      namePlaceholder: "e.g. Riverside Medical Group",
    },
    detailSummary: "All CRM detail",
    detailHint: "Revenue, accounts, and pipeline",
  };
}
