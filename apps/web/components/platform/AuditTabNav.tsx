"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";

const TABS = [
  { label: "Action Ledger",           href: "/platform/audit/ledger" },
  { label: "Capability Journal",      href: "/platform/audit/journal" },
  { label: "Routes",                  href: "/platform/audit/routes" },
  { label: "Long-running Operations", href: "/platform/audit/operations" },
  { label: "Authority",               href: "/platform/audit/authority" },
  { label: "Operational Metrics",     href: "/platform/audit/metrics" },
];

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Audit uses the flat single-row tab style.

export function AuditTabNav() {
  const pathname = usePathname();
  const active = (href: string) => pathname.startsWith(href);

  return (
    <SectionNav
      config={{
        variant: "flat",
        dataComponent: "audit-tab-nav",
        tabs: TABS.map((t) => ({
          key: t.href,
          label: t.label,
          href: t.href,
          active: active(t.href),
        })),
      }}
    />
  );
}
