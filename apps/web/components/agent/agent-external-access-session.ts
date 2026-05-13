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

type ContinuationMessage = {
  role: string;
  content: string;
  retryContent?: string | null;
};

const EXTERNAL_ACCESS_REQUEST_PATTERN =
  /\bexternal access\b[\s\S]{0,160}\b(enable|enabled|turn on|off|verify|official|public)\b/i;

export function buildExternalAccessContinuationPrompt(
  messages: ContinuationMessage[],
): string | null {
  const requestIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) =>
      (message.role === "assistant" || message.role === "system") &&
      EXTERNAL_ACCESS_REQUEST_PATTERN.test(message.content),
    )?.index;

  if (requestIndex == null) return null;

  for (let i = requestIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = (message.retryContent ?? message.content).trim();
    if (!content) return null;
    return `External Access is now enabled for this page. Continue the previous request: ${content}`;
  }

  return null;
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
