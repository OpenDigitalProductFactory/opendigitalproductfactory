"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type ComplianceFamily = {
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

const FAMILIES: ComplianceFamily[] = [
  {
    label: "Overview",
    href: "/compliance",
    description: "Scan posture, deadlines, and the latest alerts across the program.",
    matchPrefixes: ["/compliance"],
    subItems: [],
  },
  {
    label: "Library",
    href: "/compliance/policies",
    description: "Manage the rules you are accountable to and the internal policy library around them.",
    matchPrefixes: ["/compliance/policies", "/compliance/regulations", "/compliance/obligations"],
    subItems: [
      { label: "Policies", href: "/compliance/policies" },
      { label: "Regulations", href: "/compliance/regulations" },
      { label: "Obligations", href: "/compliance/obligations" },
    ],
  },
  {
    label: "Controls",
    href: "/compliance/controls",
    description: "Track controls and the evidence that proves they are working.",
    matchPrefixes: ["/compliance/controls", "/compliance/evidence"],
    subItems: [
      { label: "Controls", href: "/compliance/controls" },
      { label: "Evidence", href: "/compliance/evidence" },
    ],
  },
  {
    label: "Assurance",
    href: "/compliance/audits",
    description: "Coordinate audits, submissions, and posture review activity.",
    matchPrefixes: ["/compliance/audits", "/compliance/submissions", "/compliance/posture"],
    subItems: [
      { label: "Audits", href: "/compliance/audits" },
      { label: "Submissions", href: "/compliance/submissions" },
      { label: "Posture", href: "/compliance/posture" },
    ],
  },
  {
    label: "Risk",
    href: "/compliance/risks",
    description: "Stay on top of risks, incidents, actions, and open gaps.",
    matchPrefixes: ["/compliance/risks", "/compliance/incidents", "/compliance/actions", "/compliance/gaps"],
    subItems: [
      { label: "Risks", href: "/compliance/risks" },
      { label: "Incidents", href: "/compliance/incidents" },
      { label: "Actions", href: "/compliance/actions" },
      { label: "Gaps", href: "/compliance/gaps" },
    ],
  },
  {
    label: "Operations",
    href: "/compliance/onboard",
    description: "Handle setup and guided onboarding into the compliance program.",
    matchPrefixes: ["/compliance/onboard"],
    subItems: [
      { label: "Onboard", href: "/compliance/onboard" },
    ],
  },
];

export function ComplianceTabNav() {
  const pathname = usePathname();
  const activeFamily = FAMILIES.find((family) =>
    family.href === "/compliance"
      ? pathname === "/compliance"
      : family.matchPrefixes.some((prefix) => pathname.startsWith(prefix)),
  ) ?? FAMILIES[0];

  const subItemActive = (href: string) =>
    href === "/compliance" ? pathname === "/compliance" : pathname.startsWith(href);

  return (
    <div className="mb-6">
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--dpf-border)]">
        {FAMILIES.map((family) => {
          const isActive = activeFamily.href === family.href;
          return (
            <Link
              key={family.href}
              href={family.href}
              className={[
                "whitespace-nowrap rounded-t px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-b-2 border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                  : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {family.label}
            </Link>
          );
        })}
      </div>

      {activeFamily.subItems.length > 0 && (
        <div className="rounded-b-xl border border-t-0 border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
          <p className="text-xs text-[var(--dpf-muted)]">{activeFamily.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeFamily.subItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  subItemActive(item.href)
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
