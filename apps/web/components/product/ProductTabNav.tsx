"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";

type ProductFamily = {
  label: string;
  href: string;
  description: string;
  subItems: Array<{ label: string; href: string }>;
};

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// owns the product-scoped nav data and resolves active state from the pathname. Product
// uses the "tab" style (underline families + a boxed sub-item panel).

export function ProductTabNav({ productId }: { productId: string }) {
  const pathname = usePathname();
  const base = `/portfolio/product/${productId}`;
  const families: ProductFamily[] = [
    {
      label: "Overview",
      href: base,
      description: "Product identity, posture, and quick links into the lifecycle.",
      subItems: [],
    },
    {
      label: "Delivery",
      href: `${base}/backlog`,
      description: "Track delivery work from backlog through changes and released versions.",
      subItems: [
        { label: "Backlog", href: `${base}/backlog` },
        { label: "Changes", href: `${base}/changes` },
        { label: "Versions", href: `${base}/versions` },
      ],
    },
    {
      label: "Operate",
      href: `${base}/health`,
      description: "Monitor service health, supporting items, and dependency posture for the product.",
      subItems: [
        { label: "Health", href: `${base}/health` },
        { label: "Dependencies", href: `${base}/inventory` },
      ],
    },
    {
      label: "Architecture",
      href: `${base}/architecture`,
      description: "Understand capability and architecture elements attributed to this product.",
      subItems: [
        { label: "Architecture", href: `${base}/architecture` },
      ],
    },
    {
      label: "Commercial",
      href: `${base}/offerings`,
      description: "Define how the product is packaged and consumed.",
      subItems: [
        { label: "Offerings", href: `${base}/offerings` },
      ],
    },
    {
      label: "Team",
      href: `${base}/team`,
      description: "Assign employee owners and keep the product's working knowledge close to them.",
      subItems: [
        { label: "Team", href: `${base}/team` },
        { label: "Knowledge", href: `${base}/knowledge` },
      ],
    },
  ];

  const activeFamily = families.find((family) =>
    family.href === base
      ? pathname === base || pathname === `${base}/`
      : family.subItems.some((item) => pathname.startsWith(item.href)),
  ) ?? families[0];

  const isSubItemActive = (href: string) =>
    href === base
      ? pathname === base || pathname === `${base}/`
      : pathname.startsWith(href);

  return (
    <SectionNav
      config={{
        variant: "families",
        style: "tab",
        dataComponent: "product-tab-nav",
        families: families.map((family) => ({
          key: family.href,
          label: family.label,
          href: family.href,
          active: activeFamily.href === family.href,
        })),
        description: activeFamily.description,
        subItems: activeFamily.subItems.map((item) => ({
          label: item.label,
          href: item.href,
          active: isSubItemActive(item.href),
        })),
      }}
    />
  );
}
