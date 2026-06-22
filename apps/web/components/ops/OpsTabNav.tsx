"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OPS_NAV_GROUPS } from "./ops-nav";

// EP-NAV-COHERENCE: /ops groups its tabs into "Delivery" (Backlog) vs "Runtime &
// Releases" (Changes/Promotions/Self-upgrade/Dev Loop) so self-upgrade/dev-loop read as
// platform runtime/release operations, not delivery-queue work. The group data lives in
// ops-nav.ts (a pure module) so the navigation surface can ingest it (P3 convergence);
// P2 re-homes the Runtime & Releases routes off /ops entirely.

export function OpsTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/ops" ? pathname === "/ops" : pathname.startsWith(href);

  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-[var(--dpf-border)]">
      {OPS_NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            {group.label}
          </span>
          <div className="flex gap-1">
            {group.tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={[
                  "rounded-t px-3 py-1.5 text-xs font-medium transition-colors",
                  active(t.href)
                    ? "border-b-2 border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                    : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
