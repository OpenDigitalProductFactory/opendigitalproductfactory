"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Dashboard", href: "/admin/storefront" },
  { label: "Sections", href: "/admin/storefront/sections" },
  { label: "Items", href: "/admin/storefront/items" },
  { label: "Team", href: "/admin/storefront/team" },
  { label: "Inbox", href: "/admin/storefront/inbox" },
  { label: "Settings", href: "/admin/storefront/settings" },
];

export function StorefrontAdminTabNav() {
  const path = usePathname();
  return (
    <nav style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--dpf-border)", marginBottom: 24 }}>
      {TABS.map((tab) => {
        const active = tab.href === "/admin/storefront" ? path === "/admin/storefront" : path === tab.href;
        return (
          <Link key={tab.href} href={tab.href} style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            color: active ? "var(--dpf-accent, #4f46e5)" : "var(--dpf-muted)",
            borderBottom: active ? "2px solid var(--dpf-accent, #4f46e5)" : "2px solid transparent",
            textDecoration: "none",
          }}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
