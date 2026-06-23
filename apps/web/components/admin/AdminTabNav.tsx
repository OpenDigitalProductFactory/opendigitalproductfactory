"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_FAMILIES, getAdminFamily } from "@/components/admin/admin-nav";

// EP-NAV-COHERENCE: the admin secondary nav shows ONLY admin families — it never links
// out to /platform or /ops. Crossing to another main section is the left rail's job
// (+ the global ShellBreadcrumb). Reverted the P1 "one console" re-export that made the
// /admin row link back into /platform (founder feedback 2026-06-22: sub-menus must not
// jump to other main menu sections).

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTabNav() {
  const pathname = usePathname();
  const activeFamily = getAdminFamily(pathname);

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-2 border-b border-[var(--dpf-border)] pb-2">
        {ADMIN_FAMILIES.map((family) => {
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

      <div className="space-y-2">
        <p className="text-sm text-[var(--dpf-muted)]">{activeFamily.description}</p>
        <div className="flex flex-wrap gap-2">
          {activeFamily.subItems.map((item) => {
            const isActive = matchesPath(pathname, item.href);

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
