"use client";

import { usePathname } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";
import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "./build-studio-route-copy";

const TABS = [
  { label: "Overview", href: "/platform/ai" },
  { label: "Assignments", href: "/platform/ai/assignments" },
  { label: "Routing & Calibration", href: "/platform/ai/providers" },
  { label: BUILD_STUDIO_CONFIG_ROUTE_COPY.navLabel, href: "/platform/ai/build-studio" },
  { label: "Skills", href: "/platform/ai/skills" },
];

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// resolves active state from the pathname. Workforce uses the flat single-row tab style.

export function WorkforceTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/platform/ai"
      ? pathname === "/platform/ai"
      : pathname.startsWith(href);

  return (
    <SectionNav
      config={{
        variant: "flat",
        dataComponent: "workforce-tab-nav",
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
