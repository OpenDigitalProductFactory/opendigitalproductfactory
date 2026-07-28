"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";

export function BusinessProductTabNav({ productId }: { productId: string }) {
  const pathname = usePathname();
  const base = `/portfolio/product/${productId}/direction`;
  const subItems = [
    { label: "Brief", href: base },
    { label: "Intelligence", href: `${base}/intelligence` },
    { label: "Roadmap", href: `${base}/roadmap` },
    { label: "Outcomes", href: `${base}/outcomes` },
  ];

  return (
    <SectionNav
      config={{
        variant: "families",
        style: "tab",
        dataComponent: "business-product-tab-nav",
        families: [
          {
            key: base,
            label: "Direction",
            href: base,
            active: pathname.startsWith(base),
          },
        ],
        description:
          "Review evidence, decisions, bets, outcomes, and product-management work without changing the product definition.",
        subItems: subItems.map((item) => ({
          ...item,
          active:
            item.href === base
              ? pathname === base || pathname === `${base}/`
              : pathname.startsWith(item.href),
        })),
      }}
    />
  );
}
