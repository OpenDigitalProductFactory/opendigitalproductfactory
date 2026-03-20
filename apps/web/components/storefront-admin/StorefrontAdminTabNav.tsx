"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Dashboard", href: "/storefront" },
  { label: "Sections", href: "/storefront/sections" },
  { label: "Items", href: "/storefront/items" },
  { label: "Inbox", href: "/storefront/inbox" },
  { label: "Settings", href: "/storefront/settings" },
];

export function StorefrontAdminTabNav() {
  const path = usePathname();
  return (
    <nav style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--dpf-border)", marginBottom: 24 }}>
      {TABS.map((tab) => {
        const active = path === tab.href;
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
