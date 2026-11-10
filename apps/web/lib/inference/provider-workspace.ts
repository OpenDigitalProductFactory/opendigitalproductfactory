/** Non-secret upstream workspace selection belongs to the selected credential. */
export function normalizeProviderWorkspaceId(providerId: string, value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (providerId !== "anthropic") throw new Error("Workspace selection is supported only for Anthropic API keys");
  const workspaceId = value.trim();
  if (!workspaceId) return null;
  if (!/^wrkspc_[A-Za-z0-9]+$/.test(workspaceId)) throw new Error("Enter the Anthropic workspace ID beginning with wrkspc_");
  return workspaceId;
}

export function providerWorkspaceHeaders(providerId: string, workspaceId?: string | null): Record<string, string> {
  if (providerId !== "anthropic" || !workspaceId) return {};
  const normalized = normalizeProviderWorkspaceId(providerId, workspaceId);
  return normalized ? { "anthropic-workspace-id": normalized } : {};
}
