"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMPLIANCE_FAMILIES } from "./compliance-nav";

export function ComplianceTabNav() {
  const pathname = usePathname();
  const activeFamily = COMPLIANCE_FAMILIES.find((family) =>
    family.href === "/compliance"
      ? pathname === "/compliance"
      : family.matchPrefixes.some((prefix) => pathname.startsWith(prefix)),
  ) ?? COMPLIANCE_FAMILIES[0];

  const subItemActive = (href: string) =>
    href === "/compliance" ? pathname === "/compliance" : pathname.startsWith(href);

  return (
    <div className="mb-6">
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--dpf-border)]">
        {COMPLIANCE_FAMILIES.map((family) => {
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
