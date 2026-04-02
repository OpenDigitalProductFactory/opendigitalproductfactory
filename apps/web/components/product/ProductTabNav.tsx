"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Overview", href: "" },
  { label: "Backlog", href: "/backlog" },
  { label: "Health", href: "/health" },
  { label: "Architecture", href: "/architecture" },
  { label: "Changes", href: "/changes" },
  { label: "Inventory", href: "/inventory" },
  { label: "Versions", href: "/versions" },
  { label: "Offerings", href: "/offerings" },
  { label: "Team", href: "/team" },
];

export function ProductTabNav({ productId }: { productId: string }) {
  const pathname = usePathname();
  const base = `/portfolio/product/${productId}`;

  const active = (suffix: string) => {
    const full = base + suffix;
    return suffix === ""
      ? pathname === base || pathname === base + "/"
      : pathname.startsWith(full);
  };

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={base + t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
            active(t.href)
              ? "text-[var(--dpf-text)] border-b-2 border-[var(--dpf-accent)]"
              : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
