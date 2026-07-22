// apps/web/lib/shell/shell-action-contract.ts
//
// Common Shell Action-Result Contract (BI-9C0954D0). Single source of truth for
// the shared, testable pieces of the shell contract so components and the
// action-result smoke test reference the same strings/classes. See
// docs/superpowers/specs/2026-07-22-shell-action-result-contract-design.md and
// the "Common Shell Action-Result Contract" section of
// docs/platform-usability-standards.md.

import type { PortalAudienceMode } from "@/lib/navigation/portal-navigation-model";

/**
 * Utility class (defined in apps/web/app/globals.css `@layer components`) that
 * guarantees a ≥44×44px hit area — WCAG 2.2 AA 2.5.8 Target Size (Minimum) —
 * without forcing the visible glyph/label to grow. Apply to every interactive
 * shell control (C5).
 */
export const SHELL_TAP_TARGET_CLASS = "dpf-tap-target";

/** Accessible/visible name of the route-scoped contextual help control (C1). */
export const CONTEXTUAL_DOCS_LABEL = "Help for this page";

/** Visible name of the global documentation catalog nav item (C1). */
export const GLOBAL_DOCS_LABEL = "All docs";

/** Compact visible text for the contextual help control in the header. */
export const CONTEXTUAL_DOCS_COMPACT_LABEL = "Help";

/**
 * Persistent caption explaining what the current Simple/Full mode shows (C2/C3).
 * "worker" is the Simple view; "operator" is Full. Other audience modes fall
 * back to the Full copy (they never drive the owner rail toggle).
 */
export function navModeExplanation(mode: PortalAudienceMode): string {
  return mode === "worker"
    ? "Showing the essentials. Builder and platform tools are hidden. Switch to Full to see everything."
    : "Showing everything, including builder and platform tools.";
}

/** Live-region announcement fired when the owner switches mode (C3). */
export function navModeSwitchAnnouncement(mode: PortalAudienceMode): string {
  return mode === "worker"
    ? "Switched to Simple view — showing the essentials."
    : "Switched to Full view — showing everything.";
}

/** aria-label naming the outcome of a mode toggle button (C2). */
export function navModeToggleAriaLabel(target: PortalAudienceMode): string {
  return target === "worker" ? "Switch to Simple view" : "Switch to Full view";
}
