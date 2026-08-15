/** Catalog tiers understood by the DPF MCP Streamable HTTP endpoint. */
export type DpfMcpCatalogTier = "core" | "full";

/**
 * Add or replace DPF's explicit MCP catalog-tier hint without dropping other
 * endpoint query parameters. Known lazy hosts request `full` because the host,
 * rather than the server, owns model-facing attachment. Generic clients stay
 * on the endpoint's lean `core` default.
 */
export function withDpfMcpCatalogTier(
  endpoint: string,
  tier: DpfMcpCatalogTier,
): string {
  const parsed = new URL(endpoint);
  parsed.searchParams.set("tier", tier);
  return parsed.toString();
}
