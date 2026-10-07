"use client";

import Link from "next/link";

import { Surface } from "@/components/ui/Surface";
import { useT } from "@/lib/i18n/use-t";

type MoreToolsItem = { href: string; label: string };

// BI-E8D91AF6 (disclose-before-you-add-a-surface): the diagnostic tabs of a section
// nav, behind one "More tools" disclosure. Simple mode hides it entirely
// (globals.css, [data-advanced-tools]). A client island so both server and client
// section navs can render it with a catalog label.
export function MoreTools({ items, linkClass }: { items: readonly MoreToolsItem[]; linkClass: string }) {
  const t = useT("shell");
  if (items.length === 0) return null;
  return (
    <details data-advanced-tools className="relative">
      <summary className={`${linkClass} cursor-pointer list-none`}>{t("nav.moreTools")}</summary>
      <Surface padding="sm" className="absolute start-0 z-20 mt-1 flex min-w-[12rem] flex-col gap-1 shadow-lg">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded px-2 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
          >
            {item.label}
          </Link>
        ))}
      </Surface>
    </details>
  );
}
