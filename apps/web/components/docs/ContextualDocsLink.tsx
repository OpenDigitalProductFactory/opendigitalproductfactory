"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveDocsTarget } from "@/lib/docs-route-map";

export function ContextualDocsLink() {
  const pathname = usePathname();
  const target = resolveDocsTarget(pathname);

  return (
    <Link
      href={target.href}
      title={target.matched ? `View ${target.label} documentation` : "View documentation"}
      aria-label={target.matched ? `View ${target.label} documentation` : "View documentation"}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-2.5 text-xs font-medium text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
    >
      <span aria-hidden="true" className="text-[13px] leading-none">?</span>
      <span className="hidden sm:inline">Docs</span>
    </Link>
  );
}
