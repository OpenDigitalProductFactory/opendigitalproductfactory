// apps/web/lib/ollama.ts
// Local LLM provider health and activation logic.
// Supports Docker Model Runner (built into Docker Desktop 4.40+) and any
// OpenAI-compatible local inference endpoint.

import { prisma, syncInfraCI } from "@dpf/db";
import { discoverModelsInternal, profileModelsInternal } from "./ai-provider-internals";
import { getOllamaBaseUrl } from "./ollama-url";
export { getOllamaBaseUrl } from "./ollama-url";

// ─── Hardware info ────────────────────────────────────────────────────────────

export interface OllamaHardwareInfo {
  gpu: string;
  vramGb: number | null;
  modelCount: number;
}

/**
 * Query available models from the OpenAI-compatible /v1/models endpoint.
 * Hardware-level VRAM info is not available from Docker Model Runner.
 */
export async function getOllamaHardwareInfo(baseUrl: string): Promise<OllamaHardwareInfo | null> {
  try {
    const url = baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const modelCount = data.data?.length ?? 0;
    // Docker Model Runner uses Docker Desktop GPU passthrough — no per-model VRAM reporting
    return { gpu: "Docker Desktop", vramGb: null, modelCount };
  } catch {
    return null;
  }
}

export function estimateMaxParameters(vramGb: number | null): string | null {
  if (vramGb == null) return null;
  const maxB = Math.floor(vramGb * 0.85);
  if (maxB < 1) return "~1B";
  return `~${maxB}B`;
}

/**
 * Enrich the local inference InfraCI node with status info.
 */
async function enrichLocalInfraCI(baseUrl: string, status: string): Promise<void> {
  try {
    const hwInfo = status === "offline" ? null : await getOllamaHardwareInfo(baseUrl);
    await syncInfraCI(
      { ciId: "CI-ollama-01", name: "Local LLM (Docker Model Runner)", ciType: "ai-inference", status },
      hwInfo ? { baseUrl, gpu: hwInfo.gpu, modelCount: hwInfo.modelCount } : undefined,
    );
  } catch {
    // Neo4j unavailable — don't crash the page
  }
}

// ─── Bundled provider health check ───────────────────────────────────────────

/**
 * Page-load health check for the bundled local LLM provider.
 * Uses the OpenAI-compatible /v1/models endpoint for reachability.
 */
export async function checkBundledProviders(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({
    where: { providerId: "local" },
    select: { providerId: true, status: true, baseUrl: true, endpoint: true },
  });

  if (!provider) return;

  const baseUrl = getOllamaBaseUrl(provider);
  let reachable = false;

  try {
    const url = baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    reachable = res.ok;
  } catch {
    // Timeout or connection error
  }

  if (reachable && provider.status === "unconfigured") {
    await prisma.modelProvider.update({
      where: { providerId: "local" },
      data: { status: "active" },
    });

    const result = await discoverModelsInternal("local");
    if (result.discovered < 20) {
      await profileModelsInternal("local");
    }
    await enrichLocalInfraCI(baseUrl, "operational");
  } else if (reachable && provider.status === "active") {
    const profileCount = await prisma.modelProfile.count({ where: { providerId: "local" } });
    if (profileCount === 0) {
      const result = await discoverModelsInternal("local");
      if (result.discovered < 20) {
        await profileModelsInternal("local");
      }
    }
    await enrichLocalInfraCI(baseUrl, "operational");
  } else if (!reachable && provider.status === "active") {
    await prisma.modelProvider.update({
      where: { providerId: "local" },
      data: { status: "inactive" },
    });
    await enrichLocalInfraCI(baseUrl, "offline");
  }
}
