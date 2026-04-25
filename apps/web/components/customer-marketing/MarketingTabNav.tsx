"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Overview", href: "/customer/marketing", enabled: true },
  { label: "Strategy", href: "/customer/marketing/strategy", enabled: true },
  { label: "Campaigns", href: "/customer/marketing/campaigns", enabled: false, reason: "Phase 2" },
  { label: "Funnel", href: "/customer/marketing/funnel", enabled: false, reason: "Phase 3" },
  { label: "Automation", href: "/customer/marketing/automation", enabled: false, reason: "Phase 2" },
] as const;

export function MarketingTabNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/customer/marketing") {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-[var(--dpf-border)] pb-3">
      {TABS.map((tab) =>
        tab.enabled ? (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              isActive(tab.href)
                ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        ) : (
          <span
            key={tab.href}
            className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] opacity-80"
          >
            {tab.label}
            <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
              {tab.reason}
            </span>
          </span>
        ),
      )}
    </nav>
  );
}
