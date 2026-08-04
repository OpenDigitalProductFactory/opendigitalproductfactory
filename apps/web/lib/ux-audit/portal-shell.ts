// Portal-shell survey target set (EP-UX-AUDITOR Phase 2, BI-C3768478).
//
// Spec Goal 7 names the first mission as "the live portal shell
// (/workspace, /business, /products, /platform, /knowledge)". Those five names
// are the RECOMMENDED AREAS from the 2026-04-17 portal-nav-consolidation spec
// §6.2 — they are section identities, not routes: there is no /business or
// /products page, and the shipped model has since split Delivery out as a sixth
// section. Hardcoding the five literal paths would survey two 404s.
//
// So the target set is DERIVED from the shipped navigation model: for each
// PORTAL_SHELL_SECTIONS key, the section's home is its lowest-`primaryOrder`
// shell-nav entry. That is the same ordering the app rail itself renders, so the
// survey follows the shell as it evolves instead of drifting from it.

import {
  PORTAL_SHELL_SECTIONS,
  PORTAL_NAV_ROUTES,
  type PortalShellSectionKey,
} from "@/lib/navigation/portal-navigation-model";
import { BUTTON_DECISION_LENS, type LensSpec } from "@/lib/ux-audit/portal-survey";

/** The page lens — evaluate_page (browser-use + axe + visual-cognitive-load). */
export const PAGE_LENS: LensSpec = {
  id: "page-evaluation",
  mode: "page",
  description:
    "Evaluate the rendered page for accessibility, contrast, focus, semantic-HTML and visual-cognitive-load issues via the evaluate_page browser-use path.",
};

/** Every lens the portal-shell survey plans. */
export const PORTAL_SHELL_LENSES: LensSpec[] = [PAGE_LENS, BUTTON_DECISION_LENS];

export type PortalShellTarget = {
  sectionKey: PortalShellSectionKey;
  label: string;
  route: string;
};

/**
 * The shell-section homes, in app-rail order. Sections whose entries are all
 * dynamic or absent are omitted rather than guessed.
 */
export function portalShellTargets(): PortalShellTarget[] {
  const targets: PortalShellTarget[] = [];

  for (const section of PORTAL_SHELL_SECTIONS) {
    const candidates = PORTAL_NAV_ROUTES.filter(
      (route) =>
        route.shellNav?.sectionKey === section.key &&
        route.destinationKind !== "legacy-redirect" &&
        !route.path.includes("["),
    );
    if (candidates.length === 0) continue;

    // Lowest primaryOrder wins; entries without one sort last, ties broken by
    // declaration order (the array order the rail already relies on).
    let best = candidates[0]!;
    for (const candidate of candidates.slice(1)) {
      if (orderOf(candidate.primaryOrder) < orderOf(best.primaryOrder)) best = candidate;
    }

    targets.push({ sectionKey: section.key, label: section.label, route: best.path });
  }

  return targets;
}

function orderOf(primaryOrder: number | undefined): number {
  return primaryOrder ?? Number.POSITIVE_INFINITY;
}

/** Just the routes — what `planSurvey`'s include predicate matches against. */
export function portalShellRoutes(): string[] {
  return portalShellTargets().map((target) => target.route);
}

/**
 * Which shell routes host a coworker and therefore get behavioral lenses. The
 * coworker panel is mounted by the shared shell layout, so every shell route
 * qualifies — the predicate exists so the survey states that explicitly rather
 * than assuming it, and so a future route that opts out can say so here.
 */
export function isPortalShellCoworkerRoute(routePath: string): boolean {
  return portalShellRoutes().includes(routePath);
}
