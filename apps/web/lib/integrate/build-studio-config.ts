// apps/web/lib/integrate/build-studio-config.ts
// Reads Build Studio dispatch configuration from PlatformConfig DB table.
// Auto-resolves from configured providers when no explicit config exists.

import { prisma } from "@dpf/db";

import type { BuildModelTier } from "@/lib/explore/build-process-matrix";
import { DEFAULT_BUILD_POSTURE, coerceBuildPosture } from "@/lib/explore/build-rightsizing-dial";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle/types";
import { resolveCredentialProviderId } from "@/lib/inference/ai-provider-internals";

export type BuildStudioDispatchConfig = {
  provider: "claude" | "codex" | "grok" | "opencode" | "agentic";
  claudeProviderId: string;
  codexProviderId: string;
  grokProviderId: string;
  opencodeProviderId: string;
  claudeModel: string;
  codexModel: string;
  grokModel: string;
  opencodeModel: string;
};

const DEFAULTS: BuildStudioDispatchConfig = {
  provider: "agentic",   // safe default — no external provider needed
  claudeProviderId: "",
  codexProviderId: "",
  grokProviderId: "",
  opencodeProviderId: "",
  claudeModel: "sonnet",
  codexModel: "",
  grokModel: "",
  opencodeModel: "",     // resolved from the local provider's /v1/models at dispatch when empty
};

/**
 * Find the first configured provider for a given CLI engine.
 * Returns the providerId or empty string if none configured.
 */
async function findConfiguredProvider(cliEngine: string): Promise<string> {
  // Find providers tagged with this CLI engine
  const providers = await prisma.modelProvider.findMany({
    where: { cliEngine },
    select: { providerId: true, status: true, authMethod: true },
    orderBy: { providerId: "asc" },
  });

  if (providers.length === 0) return "";

  // Check which ones have working credentials
  for (const p of providers) {
    if (p.status !== "active") continue;
    // No-auth providers (local model endpoints: Docker Model Runner, Ollama) are
    // "configured" once active — they have no credential to gate on. This is the
    // path that lets a credential-free install auto-select the opencode runner.
    if (p.authMethod === "none") return p.providerId;
    const cred = await prisma.credentialEntry.findUnique({
      where: { providerId: resolveCredentialProviderId(p.providerId) },
      select: { status: true },
    });
    if (cred && (cred.status === "ok" || cred.status === "configured" || cred.status === "pending")) {
      return p.providerId;
    }
  }
  return "";
}

/**
 * Auto-detect the best dispatch provider based on what's configured.
 * Prefers active Claude over active Codex; falls back to agentic if nothing configured.
 */
async function autoDetectConfig(): Promise<BuildStudioDispatchConfig> {
  const claudeId = await findConfiguredProvider("claude");
  const codexId = await findConfiguredProvider("codex");
  const grokId = await findConfiguredProvider("grok");
  const opencodeId = await findConfiguredProvider("opencode");

  // Pick the first available CLI engine. Order: frontier CLIs first, then the
  // local opencode runner — so a credential-free install with a healthy local
  // provider lands on opencode rather than the legacy agentic fallback.
  let provider: BuildStudioDispatchConfig["provider"] = "agentic";
  if (claudeId) provider = "claude";
  else if (codexId) provider = "codex";
  else if (grokId) provider = "grok";
  else if (opencodeId) provider = "opencode";

  // Env var override
  const envProvider = process.env.CLI_DISPATCH_PROVIDER ?? process.env.CODEX_DISPATCH;
  if (envProvider === "claude" && claudeId) provider = "claude";
  else if (envProvider === "codex" && codexId) provider = "codex";
  else if (envProvider === "grok" && grokId) provider = "grok";
  else if (envProvider === "opencode" && opencodeId) provider = "opencode";
  else if (envProvider === "false" || envProvider === "agentic") provider = "agentic";

  return {
    provider,
    claudeProviderId: process.env.CLAUDE_CODE_PROVIDER_ID ?? claudeId,
    codexProviderId: process.env.CODEX_PROVIDER_ID ?? codexId,
    grokProviderId: process.env.GROK_PROVIDER_ID ?? grokId,
    opencodeProviderId: process.env.OPENCODE_PROVIDER_ID ?? opencodeId,
    claudeModel: process.env.CLAUDE_CODE_MODEL ?? DEFAULTS.claudeModel,
    codexModel: process.env.CODEX_MODEL ?? DEFAULTS.codexModel,
    grokModel: process.env.GROK_MODEL ?? DEFAULTS.grokModel,
    opencodeModel: process.env.OPENCODE_MODEL ?? DEFAULTS.opencodeModel,
  };
}

async function resolveBaseBuildStudioConfig(): Promise<BuildStudioDispatchConfig> {
  // If explicit config exists, use it
  const row = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });
  if (row?.value && typeof row.value === "object") {
    const saved = row.value as Partial<BuildStudioDispatchConfig>;
    // Still auto-fill provider IDs if they were left empty
    const claudeId = saved.claudeProviderId || await findConfiguredProvider("claude");
    const codexId = saved.codexProviderId || await findConfiguredProvider("codex");
    const grokId = saved.grokProviderId || await findConfiguredProvider("grok");
    const opencodeId = saved.opencodeProviderId || await findConfiguredProvider("opencode");
    return {
      ...DEFAULTS,
      ...saved,
      claudeProviderId: claudeId,
      codexProviderId: codexId,
      grokProviderId: grokId,
      opencodeProviderId: opencodeId,
    };
  }

  // No explicit config — auto-detect from configured providers
  return autoDetectConfig();
}

// EP-27FD96BC · BI-9E0595E7 — activate the dormant Build Studio cost flags.
// The quality-first routing machinery (posture compiler + sensitivity floor +
// robust-engine fallback) is fully built; it was gated behind default-off env
// vars so it could merge inert. Activation makes it operator-governed and ON by
// default, driven by the evidence the machinery already reads (the golden-
// triangle posture, pinned to Quality) — not a hidden env var.
//
// Precedence, per flag: an explicit env var is the operator's emergency
// kill-switch/override (0/false → off, 1/true → on); otherwise the PlatformConfig
// row decides (explicit false → off), defaulting ON when absent. Fail-open to the
// default (on) mirrors getBuildGoldenTrianglePosture — a config read blip must not
// silently regress substantive builds back to the local tier.
export const BUILD_MODEL_TIER_ROUTING_KEY = "BUILD_MODEL_TIER_ROUTING";
export const BUILD_QUALITY_FIRST_RIGHTSIZING_KEY = "BUILD_QUALITY_FIRST_RIGHTSIZING";

/** Env override → PlatformConfig row → default. Pure except the injected config read. */
export function resolveActivationFlag(
  envValue: string | undefined,
  configValue: unknown,
  defaultOn = true,
): boolean {
  if (envValue === "0" || envValue === "false") return false;
  if (envValue === "1" || envValue === "true") return true;
  if (configValue === false || configValue === "false" || configValue === "0") return false;
  if (configValue === true || configValue === "true" || configValue === "1") return true;
  return defaultOn;
}

async function readPlatformFlag(key: string): Promise<unknown> {
  try {
    const cfg = await prisma.platformConfig.findUnique({ where: { key } });
    return cfg?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * EP-MODEL-TIER-ROUTING (activated by BI-9E0595E7): route large/xlarge builds to
 * the configured robust (frontier) provider. ON by default; an operator disables
 * it via the `BUILD_MODEL_TIER_ROUTING` PlatformConfig row or
 * `DPF_BUILD_MODEL_TIER_ROUTING=0`. Falls back to local when no robust engine is
 * configured, so a local-only install is unaffected.
 */
export async function isModelTierRoutingEnabled(): Promise<boolean> {
  return resolveActivationFlag(
    process.env.DPF_BUILD_MODEL_TIER_ROUTING,
    await readPlatformFlag(BUILD_MODEL_TIER_ROUTING_KEY),
  );
}

/**
 * EP-QUALITY-RIGHTSIZING (activated by BI-9E0595E7): route substantive work to the
 * robust tier by default (local only for the trivial doc/chore tail) and let a
 * HIGH-sensitivity deliverable escalate its build process regardless of size. ON
 * by default; disable via the `BUILD_QUALITY_FIRST_RIGHTSIZING` PlatformConfig row
 * or `DPF_BUILD_QUALITY_FIRST_RIGHTSIZING=0`. The tier decision is still only acted
 * on when a robust engine is configured (see isModelTierRoutingEnabled).
 */
export async function isQualityFirstRightsizingEnabled(): Promise<boolean> {
  return resolveActivationFlag(
    process.env.DPF_BUILD_QUALITY_FIRST_RIGHTSIZING,
    await readPlatformFlag(BUILD_QUALITY_FIRST_RIGHTSIZING_KEY),
  );
}

/** PlatformConfig key for the global build Cost/Quality/Time posture (P2). */
export const BUILD_GOLDEN_TRIANGLE_POSTURE_KEY = "BUILD_GOLDEN_TRIANGLE_POSTURE";

/**
 * EP-QUALITY-RIGHTSIZING P2 (BI-9AF9595A): the global default build posture — the
 * operator's Cost/Quality/Time dial for Build Studio. Stored migration-free in
 * PlatformConfig; absent/malformed → DEFAULT_BUILD_POSTURE (pinned to Quality).
 * Fail-open: any read error returns the Quality default rather than throwing.
 */
export async function getBuildGoldenTrianglePosture(): Promise<GoldenTrianglePreference> {
  try {
    const cfg = await prisma.platformConfig.findUnique({
      where: { key: BUILD_GOLDEN_TRIANGLE_POSTURE_KEY },
    });
    return coerceBuildPosture(cfg?.value) ?? DEFAULT_BUILD_POSTURE;
  } catch {
    return DEFAULT_BUILD_POSTURE;
  }
}

/**
 * Resolve the first available robust (frontier) provider, preferring Claude >
 * Codex > Grok. Only active + credentialed providers qualify (the same
 * findConfiguredProvider gate the auto-detect uses). Returns null when no robust
 * engine is configured — the caller then falls back to the local/base config,
 * so a robust-tier build on a local-only install gracefully degrades to local.
 */
async function resolveRobustProvider(): Promise<
  { provider: "claude" | "codex" | "grok"; providerId: string } | null
> {
  const claudeId = await findConfiguredProvider("claude");
  if (claudeId) return { provider: "claude", providerId: claudeId };
  const codexId = await findConfiguredProvider("codex");
  if (codexId) return { provider: "codex", providerId: codexId };
  const grokId = await findConfiguredProvider("grok");
  if (grokId) return { provider: "grok", providerId: grokId };
  return null;
}

/**
 * Resolve the Build Studio dispatch config. With `opts.modelTier === "robust"`
 * AND tier routing enabled AND a robust provider configured, the config is
 * overridden to that frontier provider; otherwise the base (local/explicit)
 * config is returned unchanged. A default call (no opts) is byte-identical to
 * the pre-EP-MODEL-TIER-ROUTING behavior.
 */
export async function getBuildStudioConfig(
  opts?: { modelTier?: BuildModelTier },
): Promise<BuildStudioDispatchConfig> {
  const base = await resolveBaseBuildStudioConfig();
  if (opts?.modelTier === "robust" && (await isModelTierRoutingEnabled())) {
    const robust = await resolveRobustProvider();
    if (robust) {
      const idField =
        robust.provider === "claude"
          ? "claudeProviderId"
          : robust.provider === "codex"
            ? "codexProviderId"
            : "grokProviderId";
      return { ...base, provider: robust.provider, [idField]: robust.providerId };
    }
    // No robust engine configured — gracefully fall back to the base (local) config.
  }
  return base;
}
