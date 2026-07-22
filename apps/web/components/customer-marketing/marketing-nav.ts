// apps/web/components/customer-marketing/marketing-nav.ts
//
// Pure data for the Marketing secondary nav, lifted out of MarketingTabNav.tsx
// (EP-NAV-COHERENCE P3/P5) so the navigation surface can ingest it without importing a
// client component — registered as a navigation source in lib/ea/domain-nav-sources.ts.

export const MARKETING_TABS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Overview", href: "/customer/marketing" },
  { label: "Strategy", href: "/customer/marketing/strategy" },
  { label: "Campaigns", href: "/customer/marketing/campaigns" },
  { label: "Marketing Funnel", href: "/customer/marketing/funnel" },
  { label: "Automation", href: "/customer/marketing/automation" },
];
