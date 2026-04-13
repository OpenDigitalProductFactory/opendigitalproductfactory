"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Action Ledger",           href: "/platform/audit/ledger" },
  { label: "Capability Journal",      href: "/platform/audit/journal" },
  { label: "Routes",                  href: "/platform/audit/routes" },
  { label: "Long-running Operations", href: "/platform/audit/operations" },
  { label: "Authority",               href: "/platform/audit/authority" },
  { label: "Operational Metrics",     href: "/platform/audit/metrics" },
];

export function AuditTabNav() {
  const pathname = usePathname();
  const active = (href: string) => pathname.startsWith(href);

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
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
