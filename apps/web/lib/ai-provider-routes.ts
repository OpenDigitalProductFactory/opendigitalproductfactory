export const AI_PROVIDER_CONNECTIONS_ROUTE = "/platform/ai/providers";

/** The page title operators see at AI_PROVIDER_CONNECTIONS_ROUTE. */
export const AI_PROVIDER_CONNECTIONS_LABEL = "External Services";

/**
 * BI-7E27C0F0: where an operator goes to configure or re-authenticate a
 * provider, as text for error and recovery messages. Names the real page and
 * its route (the provider's own page when the provider is known), so guidance
 * never points at a menu path that does not exist.
 */
export function providerSetupLocation(providerId?: string | null): string {
  const route = providerId
    ? `${AI_PROVIDER_CONNECTIONS_ROUTE}/${encodeURIComponent(providerId)}`
    : AI_PROVIDER_CONNECTIONS_ROUTE;
  return `${AI_PROVIDER_CONNECTIONS_LABEL} (${route})`;
}
