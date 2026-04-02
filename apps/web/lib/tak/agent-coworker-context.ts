export function buildCoworkerContextKey(routeContext: string): string {
  const normalized = routeContext.trim() || "/workspace";
  return `coworker:${normalized}`;
}
