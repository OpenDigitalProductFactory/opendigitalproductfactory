"use client";

import { usePathname } from "next/navigation";
import { OPS_NAV_GROUPS } from "./ops-nav";
import { SectionNav } from "@/components/shell/SectionNav";

// EP-NAV-COHERENCE: /ops groups its tabs into "Delivery" (Backlog) vs "Runtime &
// Releases" (Changes/Promotions/Self-upgrade/Dev Loop) so self-upgrade/dev-loop read as
// platform runtime/release operations, not delivery-queue work. The group data lives in
// ops-nav.ts (a pure module) so the navigation surface can ingest it (P3 convergence);
// P2 re-homes the Runtime & Releases routes off /ops entirely.
//
// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Ops uses the "grouped" style.

export function OpsTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/ops" ? pathname === "/ops" : pathname.startsWith(href);

  return (
    <SectionNav
      config={{
        variant: "grouped",
        dataComponent: "ops-tab-nav",
        groups: OPS_NAV_GROUPS.map((group) => ({
          label: group.label,
          tabs: group.tabs.map((tab) => ({
            label: tab.label,
            href: tab.href,
            active: active(tab.href),
          })),
        })),
      }}
    />
  );
}
