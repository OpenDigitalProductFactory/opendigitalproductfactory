"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";

export function ProductLineTabNav({ productLineId }: { productLineId: string }) {
  const pathname = usePathname();
  const base = `/portfolio/product-line/${productLineId}/direction`;

  return (
    <SectionNav
      config={{
        variant: "families",
        style: "tab",
        dataComponent: "product-line-tab-nav",
        families: [
          {
            key: base,
            label: "Direction",
            href: base,
            active: pathname.startsWith(base),
          },
        ],
        description:
          "Compare products using available evidence, then drill into the product that needs attention.",
        subItems: [
          {
            label: "Portfolio brief",
            href: base,
            active: pathname === base || pathname === `${base}/`,
          },
        ],
      }}
    />
  );
}
