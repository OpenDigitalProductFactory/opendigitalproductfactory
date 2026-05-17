export function inferProviderIdFromRouteContext(routeContext?: string | null): string | null {
  const match = routeContext?.match(/^\/platform\/ai\/providers\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function applyProviderRouteModelPreference<T extends Record<string, unknown>>(
  modelRequirements: T,
  routeContext?: string | null,
): T & { preferredProviderId?: string } {
  const providerId = inferProviderIdFromRouteContext(routeContext);
  if (!providerId) return { ...modelRequirements };

  const next = {
    ...modelRequirements,
    preferredProviderId: providerId,
  } as T & { preferredProviderId: string; preferredModelId?: string };

  delete next.preferredModelId;
  return next;
}
