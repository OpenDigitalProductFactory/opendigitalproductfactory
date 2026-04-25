"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type CustomerTabNavItem = {
  label: string;
  href: string;
};

type Props = {
  tabs: CustomerTabNavItem[];
};

export function CustomerTabNav({ tabs }: Props) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/customer") return pathname === "/customer";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  if (tabs.length === 0) return null;

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
            isActive(t.href)
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
