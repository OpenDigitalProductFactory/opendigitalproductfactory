import { resolveCodexAuth } from "@/lib/executor-drivers/codex/auth";
import { discoverCodexCliModels as readCodexCliCatalog, type CodexCatalogLogin } from "@/lib/routing/codex-cli-model-catalog";

export async function resolveCodexCatalogAuth(providerId: string, connectionId = `provider-default-${providerId}`): Promise<CodexCatalogLogin> {
  if (!["codex", "chatgpt"].includes(providerId)) throw new Error("Unsupported Codex catalog provider");
  if (!connectionId.trim()) throw new Error("Provider connection identity is required");
  return resolveCodexAuth(providerId, { connectionId }, "app-server");
}

/** Inference owns selected credentials; the inner catalog transport accepts only prepared auth. */
export async function discoverCodexCliModels(providerId = "codex", connectionId?: string) {
  return readCodexCliCatalog(await resolveCodexCatalogAuth(providerId, connectionId));
}
