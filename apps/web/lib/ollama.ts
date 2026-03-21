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

// ─── Single-model activation ─────────────────────────────────────────────────

/**
 * For Ollama, only ONE model should be active at a time.
 * Switching between models requires VRAM unload + reload (~30s+).
 *
 * Strategy: pick the largest chat model that fits within VRAM
 * (with 30%+ headroom), activate it, deactivate everything else.
 */
async function activateBestOllamaModelOnly(baseUrl: string): Promise<void> {
  const hwInfo = await getOllamaHardwareInfo(baseUrl).catch(() => null);
  const vramGb = hwInfo?.vramGb;

  // Get all Ollama chat model profiles
  const profiles = await prisma.modelProfile.findMany({
    where: { providerId: "ollama", modelClass: "chat" },
    select: { id: true, modelId: true, modelStatus: true, maxContextTokens: true, reasoning: true, conversational: true },
  });

  if (profiles.length === 0) return;

  // Get pulled model sizes from Ollama
  let modelSizes: Record<string, number> = {};
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json() as { models?: Array<{ name: string; size: number }> };
    for (const m of data.models ?? []) {
      modelSizes[m.name] = m.size / 1e9; // Convert to GB
    }
  } catch { /* use empty — all models treated equally */ }

  // Pick best: largest model that fits in 70% of VRAM, scored by capability
  let bestId: string | null = null;
  let bestScore = -1;

  for (const p of profiles) {
    const sizeGb = modelSizes[p.modelId] ?? 0;

    // If we know VRAM, skip models too large (must leave 30% headroom)
    if (vramGb != null && sizeGb > 0 && sizeGb > vramGb * 0.7) {
      continue;
    }

    // Score: average of reasoning + conversational (the two most important for onboarding/general use)
    const score = (p.reasoning + p.conversational) / 2;
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }

  // If nothing fits in VRAM, just pick the smallest
  if (!bestId && profiles.length > 0) {
    const smallest = profiles.reduce((a, b) => {
      const aSize = modelSizes[a.modelId] ?? Infinity;
      const bSize = modelSizes[b.modelId] ?? Infinity;
      return aSize < bSize ? a : b;
    });
    bestId = smallest.id;
  }

  if (!bestId) return;

  // Activate best, deactivate rest, and ensure baseline capabilities
  const bestProfile = profiles.find((p) => p.id === bestId)!;
  console.log(`[ollama] Activating best model: ${bestProfile.modelId} (score: ${bestScore.toFixed(0)})`);

  // Ollama baseline capabilities — streaming always true, tools depend on model
  const baselineCapabilities = {
    toolUse: false,
    structuredOutput: false,
    streaming: true,
    imageInput: false,
    pdfInput: false,
    codeExecution: false,
    webSearch: false,
    computerUse: false,
  };

  for (const p of profiles) {
    if (p.id === bestId) {
      // Ensure active + capabilities are set (may be null from incomplete profiling)
      await prisma.modelProfile.update({
        where: { id: p.id },
        data: { modelStatus: "active", capabilities: baselineCapabilities },
      });
    } else {
      if (p.modelStatus === "active") {
        await prisma.modelProfile.update({ where: { id: p.id }, data: { modelStatus: "inactive" } });
        console.log(`[ollama] Deactivated ${p.modelId} (only one model active to avoid VRAM swaps)`);
      }
    }
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

    // Do NOT auto-profile Ollama models — profiling loads each model into VRAM,
    // causing expensive swaps (30s+ per model). Use seed scores instead.
    // Profiling can be triggered manually from the provider detail page.

    // Only keep the best model active — Ollama swaps are expensive (30s+ VRAM reload)
    await activateBestOllamaModelOnly(baseUrl);

    await enrichOllamaInfraCI(baseUrl, "operational");
  } else if (reachable && provider.status === "active") {
    // Already active — check if models need discovery (e.g., first run after manual activation)
    const profileCount = await prisma.modelProfile.count({ where: { providerId: "ollama" } });
    if (profileCount === 0) {
      await discoverModelsInternal("ollama");
      // Skip profiling — see note above about VRAM swaps
      await activateBestOllamaModelOnly(baseUrl);
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
