// apps/web/components/ea/EaTabNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Views", href: "/ea" },
  { label: "Reference Models", href: "/ea/models" },
];

export function EaTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/ea" ? pathname === "/ea" : pathname.startsWith(href);

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
            active(t.href)
              ? "text-white border-b-2 border-[var(--dpf-accent)]"
              : "text-[var(--dpf-muted)] hover:text-white",
          ].join(" ")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
