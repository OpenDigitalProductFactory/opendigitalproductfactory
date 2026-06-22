"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STOREFRONT_SETTINGS_TABS } from "./storefront-nav";

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StorefrontSettingsNav() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-[var(--dpf-border)] pb-2">
      {STOREFRONT_SETTINGS_TABS.map((tab) => {
        const isActive = matchesPath(pathname, tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 text-[var(--dpf-text)]"
                : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
