"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";

export type CustomerTabNavItem = {
  label: string;
  href: string;
};

type Props = {
  tabs: CustomerTabNavItem[];
};

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Customer uses the flat single-row tab style
// and wraps on narrow screens (it can carry many CRM + Marketing tabs).

export function CustomerTabNav({ tabs }: Props) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/customer") return pathname === "/customer";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  if (tabs.length === 0) return null;

  return (
    <SectionNav
      config={{
        variant: "flat",
        wrap: true,
        dataComponent: "customer-tab-nav",
        tabs: tabs.map((t) => ({
          key: t.href,
          label: t.label,
          href: t.href,
          active: isActive(t.href),
        })),
      }}
    />
  );
}
