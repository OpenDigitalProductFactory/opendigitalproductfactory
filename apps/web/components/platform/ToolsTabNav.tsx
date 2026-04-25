"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Hub", href: "/platform/tools" },
  { label: "Catalog", href: "/platform/tools/catalog" },
  { label: "Discovery Operations", href: "/platform/tools/discovery" },
  { label: "Services", href: "/platform/tools/services" },
  { label: "Enterprise Integrations", href: "/platform/tools/integrations" },
  { label: "Capability Inventory", href: "/platform/tools/inventory" },
];

function matchesPath(pathname: string, href: string): boolean {
  return href === "/platform/tools"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function ToolsTabNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
            matchesPath(pathname, t.href)
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
