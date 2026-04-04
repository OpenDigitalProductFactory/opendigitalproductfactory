"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";

type Props = {
  vocabulary: ArchetypeVocabulary;
};

export function StorefrontAdminTabNav({ vocabulary }: Props) {
  const path = usePathname();

  const tabs = [
    { label: "Dashboard", href: "/admin/storefront" },
    { label: "Sections", href: "/admin/storefront/sections" },
    { label: vocabulary.itemsLabel, href: "/admin/storefront/items" },
    { label: vocabulary.teamLabel, href: "/admin/storefront/team" },
    { label: vocabulary.inboxLabel, href: "/admin/storefront/inbox" },
    { label: "Settings", href: "/admin/storefront/settings" },
  ];

  return (
    <nav style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--dpf-border)", marginBottom: 24 }}>
      {tabs.map((tab) => {
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
