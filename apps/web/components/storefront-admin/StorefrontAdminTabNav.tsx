"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";

type Props = {
  vocabulary: ArchetypeVocabulary;
  /** Show the Animals tab — only for archetypes with an animals-available section. */
  showAnimals?: boolean;
};

export function StorefrontAdminTabNav({ vocabulary, showAnimals = false }: Props) {
  const path = usePathname();

  const tabs = [
    { label: "Dashboard", href: "/storefront" },
    { label: "Sections", href: "/storefront/sections" },
    { label: vocabulary.itemsLabel, href: "/storefront/items" },
    ...(showAnimals ? [{ label: "Animals", href: "/storefront/animals" }] : []),
    { label: vocabulary.teamLabel, href: "/storefront/team" },
    { label: vocabulary.inboxLabel, href: "/storefront/inbox" },
    { label: "Settings", href: "/storefront/settings" },
  ];

  return (
    <nav
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 0,
        borderBottom: "1px solid var(--dpf-border)",
        marginBottom: 24,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.href === "/storefront"
          ? path === "/storefront"
          : path === tab.href || path.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            color: active ? "var(--dpf-accent)" : "var(--dpf-muted)",
            borderBottom: active ? "2px solid var(--dpf-accent)" : "2px solid transparent",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
