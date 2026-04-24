"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Overview", href: "/platform/identity" },
  { label: "Principals", href: "/platform/identity/principals" },
  { label: "Groups", href: "/platform/identity/groups" },
  { label: "Directory", href: "/platform/identity/directory" },
  { label: "Federation", href: "/platform/identity/federation" },
  { label: "Applications", href: "/platform/identity/applications" },
  { label: "Authorization", href: "/platform/identity/authorization" },
  { label: "Agents", href: "/platform/identity/agents" },
];

export function IdentityTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/platform/identity" ? pathname === href : pathname.startsWith(href);

  return (
    <div className="mb-6 flex gap-1 border-b border-[var(--dpf-border)]">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={[
            "rounded-t px-3 py-1.5 text-xs font-medium transition-colors",
            active(tab.href)
              ? "border-b-2 border-[var(--dpf-accent)] text-[var(--dpf-text)]"
              : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
