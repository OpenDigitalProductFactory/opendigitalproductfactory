"use client";

import { usePathname, useRouter } from "next/navigation";
import { getPlatformFamily, PLATFORM_FAMILIES } from "@/components/platform/platform-nav";
import { SectionNav } from "@/components/shell/SectionNav";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";

// EP-NAV-COHERENCE: the platform secondary nav shows ONLY platform families — it never
// links out to /admin or /ops. Crossing to another main section is the left rail's job
// (+ the global ShellBreadcrumb for the way back). A secondary-nav tab that jumped to a
// different main section was the "Core Admin teleport" the keystone removed; the P1
// "Administration" / P2 "Runtime & Releases" console tabs re-created that cross-section
// jump and were reverted (founder feedback 2026-06-22).
//
// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// only resolves active state from the pathname.

export function PlatformTabNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeFamily = getPlatformFamily(pathname);
  const isOperationsMap = pathname === "/platform/ai/operations-map";
  const activeSubItem =
    activeFamily.subItems.find((item) =>
      item.href === activeFamily.href
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) ?? activeFamily.subItems[0];

  return (
    <>
      <div className="grid gap-2 lg:hidden" data-component="platform-mobile-nav">
        <select
          aria-label="Platform area"
          value={activeFamily.href}
          onChange={(event) => router.push(event.target.value)}
          className={[
            SHELL_TAP_TARGET_CLASS,
            "w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm font-medium text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {PLATFORM_FAMILIES.map((family) => (
            <option key={family.key} value={family.href}>
              {family.label}
            </option>
          ))}
        </select>

        {activeFamily.subItems.length > 0 && (
          <select
            aria-label={`${activeFamily.label} view`}
            value={activeSubItem?.href}
            onChange={(event) => router.push(event.target.value)}
            className={[
              SHELL_TAP_TARGET_CLASS,
              "w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm font-medium text-[var(--dpf-text)]",
            ].join(" ")}
          >
            {activeFamily.subItems.map((item) => (
              <option key={item.href} value={item.href}>
                {item.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="hidden lg:block">
        <SectionNav
          config={{
            variant: "families",
            style: "pill",
            dataComponent: "platform-tab-nav",
            dense: isOperationsMap,
            families: PLATFORM_FAMILIES.map((family) => ({
              key: family.key,
              label: family.label,
              href: family.href,
              active: family.key === activeFamily.key,
            })),
            description: activeFamily.description,
            subItems: activeFamily.subItems.map((item) => ({
              label: item.label,
              href: item.href,
              active:
                item.href === activeFamily.href
                  ? pathname === item.href
                  : pathname.startsWith(item.href),
            })),
          }}
        />
      </div>
    </>
  );
}
