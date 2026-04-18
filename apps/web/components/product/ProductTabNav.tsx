"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type ProductFamily = {
  label: string;
  href: string;
  description: string;
  subItems: Array<{ label: string; href: string }>;
};

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
        { label: "Dependencies & Estate", href: `${base}/inventory` },
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
      description: "Assign human owners and keep the product's working knowledge close to them.",
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
    <div className="mb-6">
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--dpf-border)]">
        {families.map((family) => {
          const isActive = activeFamily.href === family.href;
          return (
            <Link
              key={family.href}
              href={family.href}
              className={[
                "rounded-t px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                isActive
                  ? "text-[var(--dpf-text)] border-b-2 border-[var(--dpf-accent)]"
                  : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {family.label}
            </Link>
          );
        })}
      </div>

      {activeFamily.subItems.length > 0 && (
        <div className="rounded-b-xl border border-t-0 border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
          <p className="text-xs text-[var(--dpf-muted)]">{activeFamily.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeFamily.subItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  isSubItemActive(item.href)
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
