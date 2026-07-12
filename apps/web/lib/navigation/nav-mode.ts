// apps/web/lib/navigation/nav-mode.ts
// EP-NAV-COHERENCE / BI-655418A7 — single reader for the Simple/Full rail cookie.
// Layout filters the shell rail; workspace home also condenses page chrome when
// mode is "worker" so the toggle is not a nav-only no-op.

import type { PortalAudienceMode } from "@/lib/navigation/portal-navigation-model";

export const NAV_MODE_COOKIE = "dpf-nav-mode";

/** Parse the dpf-nav-mode cookie (or equivalent string) into a PortalAudienceMode. */
export function resolveNavModeFromCookie(value: string | undefined | null): PortalAudienceMode {
  const v = (value ?? "").trim().toLowerCase();
  // "simple" accepted as an alias if a client ever wrote the UI label by mistake.
  if (v === "worker" || v === "simple") return "worker";
  return "operator";
}

/** True when Simple (worker) mode should hide operator-dense page chrome. */
export function isSimpleNavMode(mode: PortalAudienceMode): boolean {
  return mode === "worker";
}
