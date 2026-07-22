"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildContextualDocsHref } from "@/lib/docs-route-map";
import {
  CONTEXTUAL_DOCS_LABEL,
  CONTEXTUAL_DOCS_COMPACT_LABEL,
  SHELL_TAP_TARGET_CLASS,
} from "@/lib/shell/shell-action-contract";

type Props = {
  compact?: boolean;
  routeOverride?: string;
};

// Common Shell Action-Result Contract (BI-9C0954D0) C1/C2/C4: the route-scoped
// help control must NOT share the accessible name "Docs" with the global docs
// catalog nav item. It is named "Help for this page" so assistive tech and
// automation get one unique accessible target per region.
export function ContextualDocsButton({ compact = false, routeOverride }: Props) {
  const pathname = usePathname();
  const route = routeOverride ?? pathname ?? "/";
  const href = buildContextualDocsHref(route);

  if (!href) return null;

  return (
    <Link
      href={href}
      aria-label={CONTEXTUAL_DOCS_LABEL}
      title={`${CONTEXTUAL_DOCS_LABEL} (${route})`}
      className={[
        SHELL_TAP_TARGET_CLASS,
        "rounded-full border border-[var(--dpf-border)]",
        "bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] transition-colors",
        "hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]",
        compact ? "px-3 py-1.5 text-xs font-medium" : "px-4 py-2 text-sm font-medium",
      ].join(" ")}
    >
      {compact ? CONTEXTUAL_DOCS_COMPACT_LABEL : CONTEXTUAL_DOCS_LABEL}
    </Link>
  );
}
