"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Accounts", href: "/customer" },
  { label: "Engagements", href: "/customer/engagements" },
  { label: "Pipeline", href: "/customer/opportunities" },
  { label: "Quotes", href: "/customer/quotes" },
  { label: "Orders", href: "/customer/sales-orders" },
  { label: "Funnel", href: "/customer/funnel" },
] as const;

export function CustomerTabNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/customer") return pathname === "/customer";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
            isActive(t.href)
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
