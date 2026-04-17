// apps/web/lib/govern/activate-provider.ts
// Single entry point for transitioning a provider to "active" state.
// Every activation path (OAuth, API key, Test Auth, seed, first-run bootstrap)
// calls activateProvider() instead of doing ad-hoc status/clearance/discovery updates.
//
// See: PROVIDER-ACTIVATION-AUDIT.md §5 — consolidates F-01, F-03.

import { prisma } from "@dpf/db";
import { autoDiscoverAndProfile } from "@/lib/ai-provider-internals";
import type { SensitivityLevel } from "@/lib/routing/types";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ActivationTrigger =
  | "oauth_exchange"
  | "test_auth"
  | "api_key_configure"
  | "seed"
  | "bootstrap"
  | "mcp_register";

export interface ActivateProviderOpts {
  /** How the provider was activated — logged for diagnostics. */
  trigger: ActivationTrigger;

  /** Override authMethod (set during OAuth exchange). */
  authMethod?: string;

  /** Explicit clearance override.  When omitted, derived from provider category. */
  sensitivityClearance?: SensitivityLevel[];

  /** Skip model discovery (MCP services, seeds that handle discovery separately). */
  skipDiscovery?: boolean;

  /** Activate the codex↔chatgpt sibling after this provider. */
  activateLinked?: boolean;
}

export interface ActivationResult {
  providerId: string;
  status: "active";
  clearance: SensitivityLevel[];
  discovered: number;
  profiled: number;
  warning: string | null;
}

// ─── Clearance derivation ───────────────────────────────────────────────────────

/**
 * Derive default sensitivity clearance from provider attributes.
 * Local / on-prem providers get all four levels including "restricted".
 * Cloud providers default to three levels (no "restricted").
 */
function deriveClearance(provider: {
  category: string;
  endpointType: string;
  providerId: string;
}): SensitivityLevel[] {
  if (
    provider.category === "local" ||
    provider.endpointType === "ollama" ||
    provider.providerId === "local" ||
    provider.providerId === "ollama"
  ) {
    return ["public", "internal", "confidential", "restricted"];
  }
  return ["public", "internal", "confidential"];
}

// ─── Core function ──────────────────────────────────────────────────────────────

/**
 * Activate a provider: set status, clearance, optionally authMethod, run model
 * discovery, restore runtime-retired models, and sync linked providers.
 *
 * Replaces the ad-hoc status/clearance/discover mutations previously scattered
 * across exchangeOAuthCode, testProviderAuth, configureProvider, and seeds.
 */
export async function activateProvider(
  providerId: string,
  opts: ActivateProviderOpts,
): Promise<ActivationResult> {
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { providerId: true, category: true, endpointType: true, status: true },
  });

  if (!provider) {
    return {
      providerId,
      status: "active",
      clearance: [],
      discovered: 0,
      profiled: 0,
      warning: `Provider "${providerId}" not found — skipped activation`,
    };
  }

  // 1. Derive clearance if not explicitly provided
  const clearance: SensitivityLevel[] =
    opts.sensitivityClearance ?? deriveClearance(provider);

  // 2. Update provider state atomically
  await prisma.modelProvider.update({
    where: { providerId },
    data: {
      status: "active",
      sensitivityClearance: clearance,
      ...(opts.authMethod ? { authMethod: opts.authMethod } : {}),
    },
  });

  // 3. Activate linked MCP services that depend on this provider
  try {
    const linkedServers = await prisma.mcpServer.findMany({
      where: { config: { path: ["linkedProviderId"], equals: providerId } },
    });
    for (const server of linkedServers) {
      if (server.status !== "active") {
        await prisma.mcpServer.update({
          where: { id: server.id },
          data: { status: "active" },
        });
        await prisma.modelProvider.updateMany({
          where: { providerId: server.serverId, status: { not: "active" } },
          data: { status: "active" },
        });
      }
    }
  } catch (err) {
    console.warn(`[activateProvider] MCP link activation failed for ${providerId}:`, err);
  }

  // 4. Activate sibling provider (codex↔chatgpt bidirectional sync)
  if (opts.activateLinked) {
    try {
      await activateLinkedSibling(providerId, opts);
    } catch (err) {
      console.warn(`[activateProvider] Sibling activation failed for ${providerId}:`, err);
    }
  }

  // 5. Model discovery + profiling (awaited, not fire-and-forget)
  let discovered = 0;
  let profiled = 0;
  let warning: string | null = null;

  if (!opts.skipDiscovery) {
    try {
      const result = await autoDiscoverAndProfile(providerId);
      discovered = result.discovered;
      profiled = result.profiled;
      if (result.error) {
        warning = result.error;
        console.warn(
          `[activateProvider] Discovery warning for ${providerId} (trigger=${opts.trigger}): ${result.error}`,
        );
      }
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err);
      console.warn(
        `[activateProvider] Discovery failed for ${providerId} (trigger=${opts.trigger}):`,
        err,
      );
    }
  }

  // 6. Restore models that were runtime-retired by transient errors.
  //    Only restore models retired by the fallback chain, not by catalog/admin/discovery.
  try {
    await prisma.modelProfile.updateMany({
      where: {
        providerId,
        modelStatus: { in: ["degraded", "retired"] },
        retiredReason: { in: ["model_not_found from provider"] },
      },
      data: {
        modelStatus: "active",
        retiredAt: null,
        retiredReason: null,
      },
    });
  } catch (err) {
    console.warn(`[activateProvider] Model restoration failed for ${providerId}:`, err);
  }

  return { providerId, status: "active", clearance, discovered, profiled, warning };
}

// ─── Sibling activation ─────────────────────────────────────────────────────────

// Codex and ChatGPT share the same OpenAI OAuth token.
// TODO(F-13): Replace this map with a `linkedProviderId` field on ModelProvider.
const OPENAI_PAIR: Record<string, string> = {
  codex: "chatgpt",
  chatgpt: "codex",
};

async function activateLinkedSibling(
  providerId: string,
  parentOpts: ActivateProviderOpts,
): Promise<void> {
  const siblingId = OPENAI_PAIR[providerId];
  if (!siblingId) return;

  const sibling = await prisma.modelProvider.findUnique({
    where: { providerId: siblingId },
  });
  if (!sibling) return;

  // Activate sibling without recursing into linked activation
  await activateProvider(siblingId, {
    trigger: parentOpts.trigger,
    authMethod: parentOpts.authMethod,
    skipDiscovery: parentOpts.skipDiscovery,
    activateLinked: false, // prevent infinite recursion
  });
}
