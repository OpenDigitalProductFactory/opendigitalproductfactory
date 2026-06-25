"use client";

import { usePathname } from "next/navigation";
import { ADMIN_FAMILIES, getAdminFamily } from "@/components/admin/admin-nav";
import { SectionNav } from "@/components/shell/SectionNav";

// EP-NAV-COHERENCE: the admin secondary nav shows ONLY admin families — it never links
// out to /platform or /ops. Crossing to another main section is the left rail's job
// (+ the global ShellBreadcrumb). Reverted the P1 "one console" re-export that made the
// /admin row link back into /platform (founder feedback 2026-06-22: sub-menus must not
// jump to other main menu sections).
//
// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// only resolves active state from the pathname.

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTabNav() {
  const pathname = usePathname();
  const activeFamily = getAdminFamily(pathname);

  return (
    <SectionNav
      config={{
        variant: "families",
        style: "pill",
        dataComponent: "admin-tab-nav",
        families: ADMIN_FAMILIES.map((family) => ({
          key: family.key,
          label: family.label,
          href: family.href,
          active: family.key === activeFamily.key,
        })),
        description: activeFamily.description,
        subItems: activeFamily.subItems.map((item) => ({
          label: item.label,
          href: item.href,
          active: matchesPath(pathname, item.href),
        })),
      }}
    />
  );
}
