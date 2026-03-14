export function getElevatedAssistKey(userId: string, routeContext: string): string {
  return `agent-elevated-form-assist:${userId}:${routeContext}`;
}

export function loadElevatedAssistPreference(userId: string, routeContext: string): boolean {
  try {
    return localStorage.getItem(getElevatedAssistKey(userId, routeContext)) === "true";
  } catch {
    return false;
  }
}

export function saveElevatedAssistPreference(userId: string, routeContext: string, enabled: boolean): void {
  localStorage.setItem(getElevatedAssistKey(userId, routeContext), String(enabled));
}
