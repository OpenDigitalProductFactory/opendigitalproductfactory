const LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set(["local", "ollama"]);

export function isLocalProviderId(providerId: string): boolean {
  return LOCAL_PROVIDER_IDS.has(providerId);
}
