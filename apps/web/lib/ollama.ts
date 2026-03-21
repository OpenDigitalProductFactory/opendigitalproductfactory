// apps/web/lib/ollama.ts

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
 * Query Ollama's native /api/ps and /api/tags to extract hardware info.
 * Returns null if Ollama is unreachable.
 */
export async function getOllamaHardwareInfo(baseUrl: string): Promise<OllamaHardwareInfo | null> {
  try {
    const psRes = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!psRes.ok) return null;
    const psData = await psRes.json();

    const tagsRes = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!tagsRes.ok) return null;
    const tagsData = await tagsRes.json();

    const loadedModels = psData.models ?? [];
    let totalVramBytes = 0;
    for (const m of loadedModels) {
      totalVramBytes += m.size_vram ?? 0;
    }

    const hasGpu = totalVramBytes > 0;
    const vramGb = hasGpu ? Math.round((totalVramBytes / 1_073_741_824) * 10) / 10 : null;

    // Ollama /api/ps doesn't directly report GPU name;
    // use a generic label — the InfraCI node will show "GPU (XGB VRAM)"
    const gpuName = hasGpu ? "GPU" : "CPU-only";

    return { gpu: gpuName, vramGb, modelCount: (tagsData.models ?? []).length };
  } catch {
    return null;
  }
}

/**
 * Rough estimate of max model parameters (Q4 quantization) for given VRAM.
 * Returns a human-friendly string like "~7B" or null for CPU-only.
 */
export function estimateMaxParameters(vramGb: number | null): string | null {
  if (vramGb == null) return null;
  const maxB = Math.floor(vramGb * 0.85);
  if (maxB < 1) return "~1B";
  return `~${maxB}B`;
}

/**
 * Enrich the Ollama InfraCI node with hardware info.
 * Failures are silently swallowed — Neo4j being down should not crash the page.
 */
async function enrichOllamaInfraCI(baseUrl: string, status: string): Promise<void> {
  try {
    const hwInfo = status === "offline" ? null : await getOllamaHardwareInfo(baseUrl);
    await syncInfraCI(
      { ciId: "CI-ollama-01", name: "Ollama", ciType: "ai-inference", status },
      hwInfo ? { baseUrl, gpu: hwInfo.gpu, vramGb: hwInfo.vramGb, modelCount: hwInfo.modelCount } : undefined,
    );
  } catch {
    // Neo4j unavailable — don't crash the page
  }
}

// ─── Bundled provider health check ───────────────────────────────────────────

/**
 * Page-load health check for the bundled Ollama provider.
 * - Unreachable + unconfigured → leave as-is
 * - Unreachable + active → deactivate, mark InfraCI offline
 * - Reachable + not active → activate, discover, profile, enrich hardware
 * - Reachable + already active → refresh hardware info only (no re-discovery)
 * No auth guard — this is internal server-side logic.
 */
export async function checkBundledProviders(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({
    where: { providerId: "ollama" },
    select: { providerId: true, status: true, baseUrl: true, endpoint: true },
  });

  if (!provider) return;

  const baseUrl = getOllamaBaseUrl(provider);
  let reachable = false;

  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    reachable = res.ok;
  } catch {
    // Timeout or connection error
  }

  if (reachable && provider.status === "unconfigured") {
    // First-time auto-activation — only for unconfigured providers, not intentionally disabled ones
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: { status: "active" },
    });

    const result = await discoverModelsInternal("ollama");

    // Auto-profile if reasonable model count
    if (result.discovered < 20) {
      await profileModelsInternal("ollama");
    }

    await enrichOllamaInfraCI(baseUrl, "operational");
  } else if (reachable && provider.status === "active") {
    // Already active — check if models need discovery (e.g., first run after manual activation)
    const profileCount = await prisma.modelProfile.count({ where: { providerId: "ollama" } });
    if (profileCount === 0) {
      const result = await discoverModelsInternal("ollama");
      if (result.discovered < 20) {
        await profileModelsInternal("ollama");
      }
    }
    await enrichOllamaInfraCI(baseUrl, "operational");
  } else if (!reachable && provider.status === "active") {
    // Deactivate
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: { status: "inactive" },
    });
    await enrichOllamaInfraCI(baseUrl, "offline");
  }
  // If unreachable + unconfigured → leave as-is
}
