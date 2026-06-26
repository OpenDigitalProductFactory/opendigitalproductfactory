"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";
import { MARKETING_TABS } from "./marketing-nav";

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Marketing uses the flat "pill" tone in a
// semantic <nav> element.

export function MarketingTabNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/customer/marketing") {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <SectionNav
      config={{
        variant: "flat",
        tone: "pill",
        as: "nav",
        dataComponent: "marketing-tab-nav",
        tabs: MARKETING_TABS.map((tab) => ({
          key: tab.href,
          label: tab.label,
          href: tab.href,
          active: isActive(tab.href),
        })),
      }}
    />
  );
}
