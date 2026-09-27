// apps/web/components/ops/ops-nav.ts
//
// Pure data for the Ops secondary nav, lifted out of OpsTabNav.tsx (EP-NAV-COHERENCE
// P3/P5) so the navigation surface can ingest it without importing a client component —
// registered as a navigation source in lib/ea/domain-nav-sources.ts. The two groups
// (Delivery vs Runtime & Releases) keep self-upgrade/dev-loop visibly distinct from the
// Backlog queue until P2 re-homes them off /ops entirely.
//
// EP-DELIVERY-FLOW BI-1DE21746: the Delivery group reads left-to-right as ONE flow —
// "Delivery Flow" (the investment funnel → the bet → execution board, at /ops/demand)
// leads, and "Backlog" is the execution/burn-down board (/ops) it feeds into. They
// are two faces of the same BacklogItem, no longer two duplicate boards.

// EP-2FB6C0CC (spec §9, BI-811C588E): /ops is delivery only — requests, the work in
// progress and the change flow. Keeping the platform alive (self-upgrade, patches,
// teardown, dev loop, security) moved to the Platform "Updates & health" family,
// finishing EP-NAV-COHERENCE decision D2.
export const OPS_NAV_GROUPS: ReadonlyArray<{
  label: string;
  tabs: ReadonlyArray<{ label: string; href: string }>;
}> = [
  {
    label: "Delivery",
    tabs: [
      { label: "Delivery Flow", href: "/ops/demand" },
      { label: "Requests", href: "/ops" },
      { label: "Work in progress", href: "/ops/workrooms" },
      { label: "Work control", href: "/build/work" },
      { label: "Changes", href: "/ops/changes" },
      { label: "Promotions", href: "/ops/promotions" },
      { label: "Business Journeys", href: "/ops/journeys" },
    ],
  },
];
