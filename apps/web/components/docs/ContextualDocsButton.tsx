"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildContextualDocsHref } from "@/lib/docs-route-map";

type Props = {
  compact?: boolean;
  routeOverride?: string;
};

export function ContextualDocsButton({ compact = false, routeOverride }: Props) {
  const pathname = usePathname();
  const route = routeOverride ?? pathname ?? "/";
  const href = buildContextualDocsHref(route);

  if (!href) return null;

  return (
    <Link
      href={href}
      className={[
        "inline-flex items-center rounded-full border border-[var(--dpf-border)]",
        "bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] transition-colors",
        "hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]",
        compact ? "px-3 py-1.5 text-xs font-medium" : "px-4 py-2 text-sm font-medium",
      ].join(" ")}
    >
      Docs
    </Link>
  );
}
