"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Access", href: "/admin" },
  { label: "Branding", href: "/admin/branding" },
  { label: "Reference Data", href: "/admin/reference-data" },
  { label: "Settings", href: "/admin/settings" },
];

export function AdminTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="mb-6 flex gap-1 border-b border-[var(--dpf-border)]">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={[
            "rounded-t px-3 py-1.5 text-xs font-medium transition-colors",
            active(tab.href)
              ? "border-b-2 border-[var(--dpf-accent)] text-white"
              : "text-[var(--dpf-muted)] hover:text-white",
          ].join(" ")}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
