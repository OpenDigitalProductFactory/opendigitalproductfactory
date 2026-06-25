"use client";

import { usePathname } from "next/navigation";
import { getPlatformFamily, PLATFORM_FAMILIES } from "@/components/platform/platform-nav";
import { SectionNav } from "@/components/shell/SectionNav";

// EP-NAV-COHERENCE: the platform secondary nav shows ONLY platform families — it never
// links out to /admin or /ops. Crossing to another main section is the left rail's job
// (+ the global ShellBreadcrumb for the way back). A secondary-nav tab that jumped to a
// different main section was the "Core Admin teleport" the keystone removed; the P1
// "Administration" / P2 "Runtime & Releases" console tabs re-created that cross-section
// jump and were reverted (founder feedback 2026-06-22).
//
// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// only resolves active state from the pathname.

export function PlatformTabNav() {
  const pathname = usePathname();
  const activeFamily = getPlatformFamily(pathname);
  const isOperationsMap = pathname === "/platform/ai/operations-map";

  return (
    <SectionNav
      config={{
        variant: "families",
        style: "pill",
        dataComponent: "platform-tab-nav",
        dense: isOperationsMap,
        families: PLATFORM_FAMILIES.map((family) => ({
          key: family.key,
          label: family.label,
          href: family.href,
          active: family.key === activeFamily.key,
        })),
        description: activeFamily.description,
        subItems: activeFamily.subItems.map((item) => ({
          label: item.label,
          href: item.href,
          active:
            item.href === activeFamily.href
              ? pathname === item.href
              : pathname.startsWith(item.href),
        })),
      }}
    />
  );
}
