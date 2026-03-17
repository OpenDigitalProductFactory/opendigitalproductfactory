export function getExternalAccessSessionKey(userId: string, routeContext: string): string {
  return `agent-external-access-session:${userId}:${routeContext}`;
}

export function loadExternalAccessSessionState(userId: string, routeContext: string): boolean {
  try {
    return sessionStorage.getItem(getExternalAccessSessionKey(userId, routeContext)) === "true";
  } catch {
    return false;
  }
}

export function saveExternalAccessSessionState(
  userId: string,
  routeContext: string,
  enabled: boolean,
): void {
  sessionStorage.setItem(getExternalAccessSessionKey(userId, routeContext), String(enabled));
}

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
