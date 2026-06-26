"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";
import { COMPLIANCE_FAMILIES } from "./compliance-nav";

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Compliance uses the "tab" style (underline
// families + a boxed sub-item panel shown only when the active family has sub-items).

export function ComplianceTabNav() {
  const pathname = usePathname();
  const activeFamily = COMPLIANCE_FAMILIES.find((family) =>
    family.href === "/compliance"
      ? pathname === "/compliance"
      : family.matchPrefixes.some((prefix) => pathname.startsWith(prefix)),
  ) ?? COMPLIANCE_FAMILIES[0];

  const subItemActive = (href: string) =>
    href === "/compliance" ? pathname === "/compliance" : pathname.startsWith(href);

  return (
    <SectionNav
      config={{
        variant: "families",
        style: "tab",
        dataComponent: "compliance-tab-nav",
        families: COMPLIANCE_FAMILIES.map((family) => ({
          key: family.href,
          label: family.label,
          href: family.href,
          active: activeFamily.href === family.href,
        })),
        description: activeFamily.description,
        subItems: activeFamily.subItems.map((item) => ({
          label: item.label,
          href: item.href,
          active: subItemActive(item.href),
        })),
      }}
    />
  );
}
