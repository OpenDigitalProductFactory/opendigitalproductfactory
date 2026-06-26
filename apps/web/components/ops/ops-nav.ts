// apps/web/components/ops/ops-nav.ts
//
// Pure data for the Ops secondary nav, lifted out of OpsTabNav.tsx (EP-NAV-COHERENCE
// P3/P5) so the navigation surface can ingest it without importing a client component —
// registered as a navigation source in lib/ea/domain-nav-sources.ts. The two groups
// (Delivery vs Runtime & Releases) keep self-upgrade/dev-loop visibly distinct from the
// Backlog queue until P2 re-homes them off /ops entirely.

export const OPS_NAV_GROUPS: ReadonlyArray<{
  label: string;
  tabs: ReadonlyArray<{ label: string; href: string }>;
}> = [
  {
    label: "Delivery",
    tabs: [{ label: "Backlog", href: "/ops" }],
  },
  {
    label: "Runtime & Releases",
    tabs: [
      { label: "Changes", href: "/ops/changes" },
      { label: "Promotions", href: "/ops/promotions" },
      { label: "Self-upgrade", href: "/ops/self-upgrade" },
      { label: "Patches", href: "/ops/patches" },
      { label: "Dev Loop", href: "/ops/dev-loop" },
    ],
  },
  {
    // EP-SOVEREIGN-SOC P4 — the AI SOC console (coverage / detections / cases / SLA).
    label: "Security",
    tabs: [{ label: "SOC Console", href: "/ops/security" }],
  },
];
