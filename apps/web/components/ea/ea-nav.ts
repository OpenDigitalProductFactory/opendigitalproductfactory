// apps/web/components/ea/ea-nav.ts
//
// Pure data for the EA (Architecture) secondary nav, lifted out of EaTabNav.tsx
// (EP-NAV-COHERENCE P3/P5) so the navigation surface can ingest it without importing a
// client component — registered as a navigation source in lib/ea/domain-nav-sources.ts.

export const EA_TABS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Overview", href: "/ea" },
  { label: "Capability Map", href: "/ea/capabilities" },
  { label: "Value Streams", href: "/ea/value-streams" },
  { label: "Workrooms", href: "/ea/workrooms" },
  { label: "Data Model", href: "/ea/data-model" },
  { label: "Views & Viewpoints", href: "/ea/views" },
  { label: "Reference Models", href: "/ea/models" },
];
