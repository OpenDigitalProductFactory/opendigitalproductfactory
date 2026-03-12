// apps/web/components/shell/NavBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { label: string; href: string };

export function NavBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              active
                ? "bg-[var(--dpf-accent)] text-white"
                : "text-[var(--dpf-muted)] hover:text-white border border-[var(--dpf-border)]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
