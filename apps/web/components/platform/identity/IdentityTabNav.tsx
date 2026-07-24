"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";

const TABS = [
  { label: "Overview", href: "/platform/identity" },
  { label: "Principals", href: "/platform/identity/principals" },
  { label: "Groups", href: "/platform/identity/groups" },
  { label: "Directory", href: "/platform/identity/directory" },
  { label: "Federation", href: "/platform/identity/federation" },
  { label: "Applications", href: "/platform/identity/applications" },
  { label: "Authorization", href: "/platform/identity/authorization" },
  { label: "AI Coworkers", href: "/platform/identity/agents" },
];

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Identity uses the flat single-row tab style.

export function IdentityTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/platform/identity" ? pathname === href : pathname.startsWith(href);

  return (
    <SectionNav
      config={{
        variant: "flat",
        dataComponent: "identity-tab-nav",
        tabs: TABS.map((tab) => ({
          key: tab.href,
          label: tab.label,
          href: tab.href,
          active: active(tab.href),
        })),
      }}
    />
  );
}
