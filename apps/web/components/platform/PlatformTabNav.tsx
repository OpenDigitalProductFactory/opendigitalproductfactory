"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getPlatformFamily, PLATFORM_FAMILIES } from "@/components/platform/platform-nav";

// EP-NAV-COHERENCE: the platform secondary nav shows ONLY platform families — it never
// links out to /admin or /ops. Crossing to another main section is the left rail's job
// (+ the global ShellBreadcrumb for the way back). A secondary-nav tab that jumped to a
// different main section was the "Core Admin teleport" the keystone removed; the P1
// "Administration" / P2 "Runtime & Releases" console tabs re-created that cross-section
// jump and were reverted (founder feedback 2026-06-22).

export function PlatformTabNav() {
  const pathname = usePathname();
  const activeFamily = getPlatformFamily(pathname);
  const isOperationsMap = pathname === "/platform/ai/operations-map";

  return (
    <div className={isOperationsMap ? "mb-3 space-y-2" : "mb-6 space-y-3"}>
      <div className="flex flex-wrap gap-2 border-b border-[var(--dpf-border)] pb-2">
        {PLATFORM_FAMILIES.map((family) => {
          const isActive = family.key === activeFamily.key;

          return (
            <Link
              key={family.key}
              href={family.href}
              className={[
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 text-[var(--dpf-text)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {family.label}
            </Link>
          );
        })}
      </div>

      <div className={isOperationsMap ? "space-y-1" : "space-y-2"}>
        <p className={isOperationsMap ? "sr-only" : "text-sm text-[var(--dpf-muted)]"}>{activeFamily.description}</p>
        <div className="flex flex-wrap gap-2">
          {activeFamily.subItems.map((item) => {
            const isActive =
              item.href === activeFamily.href
                ? pathname === item.href
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  isActive
                    ? "border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
