"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Workforce", href: "/platform/ai" },
  { label: "External Services", href: "/platform/ai/providers" },
  { label: "Route Log", href: "/platform/ai/routing" },
  { label: "Action History", href: "/platform/ai/history" },
];

export function AiTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/platform/ai"
      ? pathname === "/platform/ai"
      : pathname.startsWith(href);

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
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
