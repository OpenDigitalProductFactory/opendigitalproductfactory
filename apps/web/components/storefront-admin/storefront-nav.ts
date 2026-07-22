// apps/web/components/storefront-admin/storefront-nav.ts
//
// Pure data for the Storefront secondary nav (EP-NAV-COHERENCE P3). The top tabs in
// StorefrontAdminTabNav are archetype-DYNAMIC (vocabulary labels + conditional
// Units/Animals), so STOREFRONT_ROUTES is the STATIC route inventory the navigation
// surface ingests (registered in lib/ea/domain-nav-sources.ts) — it mirrors the admin
// tab routes with stable labels. The settings sub-nav is fully static and is the single
// source for both StorefrontSettingsNav and the surface.

export const STOREFRONT_ROUTES: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Dashboard", href: "/storefront" },
  { label: "Sections", href: "/storefront/sections" },
  { label: "Items", href: "/storefront/items" },
  { label: "Tables & Capacity", href: "/storefront/tables" },
  { label: "Units", href: "/storefront/units" },
  { label: "Animals", href: "/storefront/animals" },
  { label: "Team", href: "/storefront/team" },
  { label: "Inbox", href: "/storefront/inbox" },
  { label: "Settings", href: "/storefront/settings" },
];

export const STOREFRONT_SETTINGS_TABS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Portal", href: "/storefront/settings" },
  { label: "Your Business", href: "/storefront/settings/business" },
  { label: "Capabilities", href: "/storefront/settings/capabilities" },
  { label: "Operating Hours", href: "/storefront/settings/operations" },
];
