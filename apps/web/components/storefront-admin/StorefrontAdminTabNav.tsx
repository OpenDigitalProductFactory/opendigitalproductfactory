"use client";
import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";

type Props = {
  vocabulary: ArchetypeVocabulary;
  /** Show the Animals tab — only for archetypes with an animals-available section. */
  showAnimals?: boolean;
  /** Show the Units tab — only for rental archetypes with a stockable fleet. */
  showUnits?: boolean;
  /** Show the Dispatch tab — only for field-service (trades-maintenance) storefronts. */
  showDispatch?: boolean;
  /** Show the Intake tab — only for healthcare and dental practice storefronts. */
  showIntake?: boolean;
};

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper owns
// the archetype-aware tab labels and resolves active state from the pathname. Storefront
// admin uses the flat "emphasis" tone (the heavier storefront-management strip).

export function StorefrontAdminTabNav({
  vocabulary,
  showAnimals = false,
  showUnits = false,
  showDispatch = false,
  showIntake = false,
}: Props) {
  const path = usePathname();

  const tabs = [
    { label: "Dashboard", href: "/storefront" },
    { label: "Sections", href: "/storefront/sections" },
    { label: vocabulary.itemsLabel, href: "/storefront/items" },
    ...(showUnits ? [{ label: "Units", href: "/storefront/units" }] : []),
    ...(showAnimals ? [{ label: "Animals", href: "/storefront/animals" }] : []),
    { label: vocabulary.teamLabel, href: "/storefront/team" },
    ...(showDispatch ? [{ label: "Dispatch", href: "/storefront/dispatch" }] : []),
    ...(showIntake ? [{ label: "Intake", href: "/storefront/intake" }] : []),
    { label: vocabulary.inboxLabel, href: "/storefront/inbox" },
    { label: "Settings", href: "/storefront/settings" },
  ];

  const isActive = (href: string) =>
    href === "/storefront"
      ? path === "/storefront"
      : path === href || path.startsWith(`${href}/`);

  return (
    <SectionNav
      config={{
        variant: "flat",
        tone: "emphasis",
        as: "nav",
        dataComponent: "storefront-admin-tab-nav",
        tabs: tabs.map((tab) => ({
          key: tab.href,
          label: tab.label,
          href: tab.href,
          active: isActive(tab.href),
        })),
      }}
    />
  );
}
