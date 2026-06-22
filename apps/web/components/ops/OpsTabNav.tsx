"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// EP-NAV-COHERENCE keystone (BI-8866F144): /ops used to present one flat tab row
// — Backlog · Improvements · Changes · Promotions · Self-upgrade · Dev Loop —
// under the rail item labelled "Backlog", so a layman read "why is self-upgrade
// under backlog?". Self-upgrade (the platform deploying itself) and the dev-loop
// (build-runtime coordination) are platform runtime/release operations, not
// delivery-queue work. We group the row into two labelled clusters so the
// distinction is visible now; P1 (BI-CB07C8BA) folds Runtime & Releases into the
// operator console and P2 (BI-058EA759) re-homes the dev-loop under Build Studio,
// at which point these stop living under /ops at all.
const GROUPS: Array<{ label: string; tabs: Array<{ label: string; href: string }> }> = [
  {
    label: "Delivery",
    tabs: [
      { label: "Backlog", href: "/ops" },
      { label: "Improvements", href: "/ops/improvements" },
    ],
  },
  {
    label: "Runtime & Releases",
    tabs: [
      { label: "Changes", href: "/ops/changes" },
      { label: "Promotions", href: "/ops/promotions" },
      { label: "Self-upgrade", href: "/ops/self-upgrade" },
      { label: "Dev Loop", href: "/ops/dev-loop" },
    ],
  },
];

export function OpsTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/ops" ? pathname === "/ops" : pathname.startsWith(href);

  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-[var(--dpf-border)]">
      {GROUPS.map((group) => (
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
