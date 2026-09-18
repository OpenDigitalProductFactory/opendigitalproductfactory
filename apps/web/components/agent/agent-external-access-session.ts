// EP-WORK-POSTURE 8.2 (BI-947780FE): the per-session "Web access" state and its
// continuation prompt that used to live here are retired. Web access follows
// the Workroom and the coworker's standing grant, resolved server-side per
// turn. Only the Advise / Act mode remains a per-route session preference.

// ─── Advise / Act session state (per-route-scoped) ───────────────────────────

export type CoworkerMode = "advise" | "act";

function getCoworkerModeKey(userId: string, routeContext: string): string {
  return `coworker-mode-session:${userId}:${routeContext}`;
}

export function loadCoworkerMode(userId: string, routeContext: string): CoworkerMode {
  if (typeof window === "undefined") return "advise";
  const key = getCoworkerModeKey(userId, routeContext);
  const stored = sessionStorage.getItem(key);
  return stored === "act" ? "act" : "advise";
}

export function saveCoworkerMode(userId: string, routeContext: string, mode: CoworkerMode): void {
  if (typeof window === "undefined") return;
  const key = getCoworkerModeKey(userId, routeContext);
  sessionStorage.setItem(key, mode);
}
