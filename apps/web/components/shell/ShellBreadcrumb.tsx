"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { getRouteNavRecord } from "@/lib/navigation/portal-navigation-model";

// EP-NAV-COHERENCE keystone (BI-8866F144). The shell had no breadcrumb anywhere —
// only Portfolio/Product carried bespoke local ones — so any move that swapped the
// secondary-nav context (the named Platform Hub -> Core Admin jump) left the user
// with "no way to navigate back". This derives a climbable trail from the canonical
// portal-navigation-model's parentPath chain, so every shell route now shows where
// it is and how to get back. Best-effort: routes outside the model fall back to
// title-cased URL segments.
//
// The trail is filtered by the SAME capability the destination route enforces
// (BI-2777B86B). It was not, and the model is a route inventory rather than an
// authorization list, so an HR-500 Operations Manager and an HR-600 Workforce
// Member both got a "Portal" crumb linking to /storefront — the one page whose
// layout refuses them `view_storefront` and returns 404. The rail had always
// hidden it; the crumb was a second list that drifted. Passing the principal's
// granted keys keeps the two derived from one registry.

type Crumb = { label: string; href: string };

function titleCase(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep malformed path segments legible without breaking shell navigation.
  }
  return decoded
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** A crumb is offered only to a principal who can open it. The granted set is
 *  required rather than optional: a fail-open default is how the rail and the
 *  trail came apart in the first place. A route carrying no capability key is
 *  open to anyone already inside the shell. */
function canOpen(
  capabilityKey: string | null | undefined,
  capabilities: ReadonlySet<string>,
): boolean {
  return capabilityKey == null || capabilities.has(capabilityKey);
}

export function buildBreadcrumbTrail(
  pathname: string,
  capabilities: ReadonlySet<string>,
  labelOverrides: Readonly<Record<string, string>> = {},
): Crumb[] {
  const record = getRouteNavRecord(pathname);

  // Preferred path: walk the canonical parentPath chain to the domain root.
  if (record) {
    const trail: Crumb[] = [];
    const seen = new Set<string>();
    let current: ReturnType<typeof getRouteNavRecord> | undefined = record;
    while (current && !seen.has(current.path)) {
      seen.add(current.path);
      if (canOpen(current.capabilityKey, capabilities)) {
        trail.unshift({ label: labelOverrides[current.key] ?? current.label, href: current.path });
      }
      if (current.parentPath === current.path) break;
      current = getRouteNavRecord(current.parentPath);
    }
    return trail;
  }

  // Fallback: derive from URL segments, resolving labels from the model where the
  // cumulative path is known (e.g. /admin), otherwise title-casing the segment.
  // An unmodelled segment carries no capability, so it is left alone; a modelled
  // one is filtered on the same key as above.
  const segments = pathname.split("/").filter(Boolean);
  const trail: Crumb[] = [];
  let accumulated = "";
  for (const segment of segments) {
    accumulated += `/${segment}`;
    const known = getRouteNavRecord(accumulated);
    if (known && !canOpen(known.capabilityKey, capabilities)) continue;
    trail.push({ label: known?.label ?? titleCase(segment), href: accumulated });
  }
  return trail;
}

export function ShellBreadcrumb({
  capabilities,
  labelOverrides = {},
}: {
  capabilities: readonly string[];
  labelOverrides?: Readonly<Record<string, string>>;
}) {
  const pathname = usePathname();
  const granted = useMemo(() => new Set(capabilities), [capabilities]);

  // Portfolio ships its own tree + product-header breadcrumb; rendering a second
  // global trail there would double up. Reconciled into the shared model in
  // EP-NAV-COHERENCE P5 (BI-74158F1A).
  if (pathname.startsWith("/portfolio")) return null;

  const trail = buildBreadcrumbTrail(pathname, granted, labelOverrides);

  // A single crumb (you are on a domain home) needs no trail.
  if (trail.length < 2) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-[var(--dpf-muted)]"
    >
      {trail.map((crumb, index) => {
        const isLast = index === trail.length - 1;
        return (
          <span key={crumb.href} className="flex items-center gap-1.5">
            {index > 0 && (
              <span aria-hidden className="select-none text-[var(--dpf-border)]">
                /
              </span>
            )}
            {isLast ? (
              <span aria-current="page" className="font-medium text-[var(--dpf-text)]">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="transition-colors hover:text-[var(--dpf-text)]"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
