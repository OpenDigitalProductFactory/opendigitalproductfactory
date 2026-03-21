"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Dashboard", href: "/compliance" },
  { label: "Policies", href: "/compliance/policies" },
  { label: "Regulations", href: "/compliance/regulations" },
  { label: "Obligations", href: "/compliance/obligations" },
  { label: "Controls", href: "/compliance/controls" },
  { label: "Evidence", href: "/compliance/evidence" },
  { label: "Risks", href: "/compliance/risks" },
  { label: "Incidents", href: "/compliance/incidents" },
  { label: "Audits", href: "/compliance/audits" },
  { label: "Actions", href: "/compliance/actions" },
  { label: "Gaps", href: "/compliance/gaps" },
  { label: "Posture", href: "/compliance/posture" },
  { label: "Submissions", href: "/compliance/submissions" },
  { label: "Onboard", href: "/compliance/onboard" },
];

export function ComplianceTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/compliance" ? pathname === "/compliance" : pathname.startsWith(href);

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)] overflow-x-auto">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors whitespace-nowrap",
            active(t.href)
              ? "text-[var(--dpf-text)] border-b-2 border-[var(--dpf-accent)]"
              : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
