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
