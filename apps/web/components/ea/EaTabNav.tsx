// apps/web/components/ea/EaTabNav.tsx
"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";
import { EA_TABS } from "./ea-nav";

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. EA uses the flat single-row tab style.

export function EaTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/ea" ? pathname === "/ea" : pathname.startsWith(href);

  return (
    <SectionNav
      config={{
        variant: "flat",
        dataComponent: "ea-tab-nav",
        tabs: EA_TABS.map((t) => ({
          key: t.href,
          label: t.label,
          href: t.href,
          active: active(t.href),
        })),
      }}
    />
  );
}
