"use client";

import { usePathname } from "next/navigation";
import { FINANCE_FAMILIES, getFinanceFamily } from "@/components/finance/finance-nav";
import { SectionNav } from "@/components/shell/SectionNav";

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Finance uses the "tab" style (underline
// families + a boxed sub-item panel shown only when the active family has sub-items).

function isSubItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type FinanceNavigationLabels = Partial<Record<"revenue" | "spend" | "close" | "configuration", string>>;

export function FinanceTabNav({ labels }: { labels?: FinanceNavigationLabels } = {}) {
  const pathname = usePathname();
  const activeFamily = getFinanceFamily(pathname);

  return (
    <SectionNav
      config={{
        variant: "families",
        style: "tab",
        dataComponent: "finance-tab-nav",
        families: FINANCE_FAMILIES.map((family) => ({
          key: family.key,
          label: labels?.[family.key as keyof FinanceNavigationLabels] ?? family.label,
          href: family.href,
          active: activeFamily.href === family.href,
        })),
        description: activeFamily.description,
        subItems: activeFamily.subItems.map((item) => ({
          label: item.label,
          href: item.href,
          active: isSubItemActive(pathname, item.href),
        })),
      }}
    />
  );
}
