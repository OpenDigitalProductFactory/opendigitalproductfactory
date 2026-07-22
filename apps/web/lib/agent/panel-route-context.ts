import { getRouteNavRecord } from "@/lib/navigation/portal-navigation-model";

/**
 * BI-3238AAF0: the coworker side panel must clearly identify the route/business
 * context it is currently attached to, so an owner who lands on it (or carried
 * it across a navigation) can tell WHERE the coworker is helping rather than
 * seeing anonymous assistant chrome.
 *
 * Pure and client-safe: resolves a short human label for a pathname from the
 * canonical portal navigation model, falling back to title-cased URL segments
 * so an unmodelled route still reads as a business area rather than a raw slug.
 */

function titleCase(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const ROOT_LABEL = "Workspace";

export function resolvePanelRouteContextLabel(pathname: string | null | undefined): string {
  const raw = (pathname ?? "").split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!raw || raw === "/") return ROOT_LABEL;

  // Exact model match wins (e.g. "/customer/marketing" → "Marketing").
  const exact = getRouteNavRecord(raw);
  if (exact) return exact.label;

  // Otherwise walk the segments and prefer the deepest KNOWN nav-record label.
  // Unknown deep segments (ids, slugs) are skipped in favour of the nearest
  // modelled ancestor so the panel never surfaces a raw id as its context.
  const segments = raw.split("/").filter(Boolean);
  let accumulated = "";
  let deepestKnown: string | null = null;
  for (const segment of segments) {
    accumulated += `/${segment}`;
    const known = getRouteNavRecord(accumulated);
    if (known) deepestKnown = known.label;
  }
  if (deepestKnown) return deepestKnown;

  // No modelled ancestor at all — title-case the top-level business domain.
  const firstSegment = segments[0];
  return firstSegment ? titleCase(firstSegment) : ROOT_LABEL;
}
